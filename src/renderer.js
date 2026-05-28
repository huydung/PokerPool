import { Application, Container, Graphics, Text, TextStyle, Sprite, Texture } from 'pixi.js';
import { CONFIG } from './config.js';
import { evaluatePokerHand } from './poker.js';

/**
 * CanvasRenderer using Pixi.js
 * Draws the table layout, sensory pockets, dynamic ball overlays, and interactive lasers.
 */
export class CanvasRenderer {
  /**
   * @param {HTMLElement} containerElement DOM element to mount the canvas on
   * @param {Object} config The centralized CONFIG object
   */
  constructor(containerElement, config = CONFIG) {
    this.containerElement = containerElement;
    this.config = config;

    this.app = null;
    
    // Pixi Containers
    this.tableContainer = new Container();
    this.ballContainer = new Container();
    this.hudContainer = new Container();
    this.aimContainer = new Container();

    // Mapping: Matter.js body ID -> Pixi Container
    this.ballViews = new Map();
    /** Maps bodyId → the seam sub-container that rotates to simulate rolling */
    this._ballSeamContainers = new Map();
    /** Maps bodyId → accumulated roll angle (radians) for the rolling visual */
    this._ballRollAngles = new Map();
    /** Pixi Graphics dot inside the spin UI — updated each frame */
    this._spinUiDot = null;
    /** Container holding all static spin UI graphics */
    this._spinUiContainer = new Container();
    
    // Pocket graphic references for diagnostic glowing
    this.pocketGraphics = [];
    this.pocketSuits = new Array(6).fill(null);
    this.gameRef = null;
    
    // HUD element references
    this.player1HandGraphics = [];
    this.player2HandGraphics = [];
    this.p1CardsContainer = null;
    this.p2CardsContainer = null;
    this.player1ScoreText = null;
    this.player2ScoreText = null;
    this.activePlayerText = null;
    this.p1HUDContainer = null;
    this.p2HUDContainer = null;
    // this.p1HandLabel = null;
    // this.p2HandLabel = null;

    // Laser overlay graphics
    this.aimGraphics = new Graphics();

    // Slider overlay graphics
    this.sliderGraphics = new Graphics();

    // Top-level UI container for Pixi-native overlays (BIH button, etc.)
    this.uiContainer = new Container();
    this._bihConfirmButton = null;

    // ── Cheat overlay container: selection rings drawn above balls, below HUD ──
    this._cheatOverlayContainer = new Container();
    this._cheatBallRings = new Map();   // bodyId → Graphics ring
    this._cheatPocketRings = [];        // index-matched Graphics rings per pocket

    // ── Right-side icon panel ──────────────────────────────────────────────────
    this.rightPanelContainer = new Container();
    this._cheatEnabled = false;
    this._cheatFinishBtn = null;        // Pixi "Finish Shot" button container
    this._cheatTogglePill = null;       // The toggle pill graphics object

    // Callbacks wired from main.js / game.js
    /** @type {function|null} Called when the ? (rules) icon is clicked */
    this.onRulesRequest = null;
    /** @type {function(boolean)|null} Called when the cheat toggle changes */
    this.onCheatToggle = null;
    /** @type {function|null} Called when the Finish Shot button is pressed */
    this.onCheatFinishShot = null;

    // Active Player Turn Name tracking
    this.player1Name = this.config.rules?.player1Name || 'Player 1';
    this.player2Name = this.config.rules?.player2Name || 'Player 2';
    this.activePlayerName = this.player1Name;
  }

  /**
   * Initializes the Pixi Application asynchronously (supporting Pixi.js v8)
   */
  async init() {
    this.app = new Application();
    
    // Initialize the app asynchronously in Pixi v8
    await this.app.init({
      width: this.config.canvas.width,
      height: this.config.canvas.height,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundColor: 0x0e1726 // Rich dark deep-space blue background
    });

    // Append canvas to container
    this.containerElement.appendChild(this.app.canvas);
    
    // Enable letterboxed scaling through CSS on the canvas
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.app.canvas.style.maxWidth = '100%';
    this.app.canvas.style.maxHeight = '100%';
    this.app.canvas.style.objectFit = 'contain';

    // Add containers to stage in correct draw order
    this.app.stage.addChild(this.tableContainer);
    this.app.stage.addChild(this.aimContainer);
    this.app.stage.addChild(this.ballContainer);
    this.app.stage.addChild(this._cheatOverlayContainer); // cheat selection rings (above balls)
    this.app.stage.addChild(this.hudContainer);
    this.app.stage.addChild(this.sliderGraphics); // Top-level glassmorphic slider overlay
    this.app.stage.addChild(this.uiContainer);    // Floating Pixi UI (BIH confirm button, etc.)
    this.app.stage.addChild(this._spinUiContainer); // Spin/English selector (always on top of table)
    this.app.stage.addChild(this.rightPanelContainer); // always-on-top right icon panel

    this.aimContainer.addChild(this.aimGraphics);

    this.drawTableLayout();
    this.drawHUDLayout();
    this.drawRightPanel();
    this.drawSpinUI();
  }

  /**
   * Helper to create a linear gradient texture using a 2D HTML Canvas
   */
  createGradientTexture(colorHex, fromLeft) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    
    // Convert hex color (e.g. 0x00e5ff) to CSS color string
    const cssColor = '#' + colorHex.toString(16).padStart(6, '0');
    
    let gradient = ctx.createLinearGradient(0, 0, 512, 0);
    if (fromLeft) {
      gradient.addColorStop(0, cssColor);
      gradient.addColorStop(0.15, cssColor); // Keep strong for first 15%
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.85, cssColor); // Keep strong towards the right edge
      gradient.addColorStop(1, cssColor);
    }
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 100);
    
    return Texture.from(canvas);
  }

  /**
   * Draw the visual elements of the pool table felt, rails, cushions, and pockets.
   */
  drawTableLayout() {
    const { xCenter, yCenter, width, height, railWidth } = this.config.table;
    const { colors } = this.config.visuals;

    const hw = width / 2;
    const hh = height / 2;
    const rw = railWidth;

    // 1. Draw solid outer wooden rails (Frame)
    const rails = new Graphics();
    rails.rect(
      xCenter - hw - rw,
      yCenter - hh - rw,
      width + rw * 2,
      height + rw * 2
    );
    rails.fill({ color: colors.rail });
    rails.stroke({ color: 0x271710, width: 4 }); // Darker outline for thickness depth
    this.tableContainer.addChild(rails);

    // 2. Draw outer boundary gold rim/shadow
    const borderShadow = new Graphics();
    borderShadow.rect(
      xCenter - hw - 2,
      yCenter - hh - 2,
      width + 4,
      height + 4
    );
    borderShadow.stroke({ color: 0xb58e3d, width: 2, alpha: 0.3 });
    this.tableContainer.addChild(borderShadow);

    // 3. Draw blue table felt
    const felt = new Graphics();
    felt.rect(xCenter - hw, yCenter - hh, width, height);
    felt.fill({ color: colors.felt });
    this.tableContainer.addChild(felt);

    // 4. Draw head string (dashed white line)
    const headStringX = xCenter - width / 4;
    const headString = new Graphics();
    headString.moveTo(headStringX, yCenter - hh);
    headString.lineTo(headStringX, yCenter + hh);
    headString.stroke({ color: colors.headString, width: 1.5, alpha: 0.4 });
    this.tableContainer.addChild(headString);

    // 4b. Draw respawn spot markers on the felt (subtle low-opacity crosses)
    const respawnSpots = this.config.rules?.respawnMatrix || [];
    respawnSpots.forEach(spot => {
      const marker = new Graphics();
      marker.moveTo(spot.x - 4, spot.y);
      marker.lineTo(spot.x + 4, spot.y);
      marker.moveTo(spot.x, spot.y - 4);
      marker.lineTo(spot.x, spot.y + 4);
      marker.stroke({ color: colors.headString, width: 1.5, alpha: 0.35 });
      this.tableContainer.addChild(marker);
    });

    // 5. Draw visual pockets (aligned with sensory coordinate nodes)
    const pocketPositions = [
      { x: xCenter - hw, y: yCenter - hh, type: 'corner' }, // TL
      { x: xCenter + hw, y: yCenter - hh, type: 'corner' }, // TR
      { x: xCenter - hw, y: yCenter + hh, type: 'corner' }, // BL
      { x: xCenter + hw, y: yCenter + hh, type: 'corner' }, // BR
      { x: xCenter, y: yCenter - hh - this.config.pocket.sideOffset, type: 'side' }, // ST
      { x: xCenter, y: yCenter + hh + this.config.pocket.sideOffset, type: 'side' }  // SB
    ];

    pocketPositions.forEach((pos, idx) => {
      const pocketView = new Container();
      pocketView.x = pos.x;
      pocketView.y = pos.y;

      // Unmapped state outer rim (standard gray border, glowing yellow/valid)
      const glow = new Graphics();
      glow.circle(0, 0, this.config.pocket.radius + 3);
      glow.fill({ color: this.config.visuals.pockets.unclaimed, alpha: 0.2 });
      pocketView.addChild(glow);

      const rim = new Graphics();
      rim.circle(0, 0, this.config.pocket.radius + 1);
      rim.stroke({ color: this.config.visuals.colors.pocketBorder || 0x424242, width: 3 });
      rim.circle(0, 0, this.config.pocket.radius);
      rim.fill({ color: colors.pocketBg });
      pocketView.addChild(rim);

      const suitContainer = new Container();
      pocketView.addChild(suitContainer);

      this.pocketGraphics.push({ container: pocketView, glow, rim, suitContainer, type: pos.type });
      this.tableContainer.addChild(pocketView);
    });

    // ── Cover strips ───────────────────────────────────────────────────────────
    // Draw background-colour rectangles over the four outer strips so that any
    // pocket circle pixels that extend beyond the outer rail are hidden cleanly.
    // These sit above the pocket graphics in the tableContainer draw order, but
    // below every other container (balls, HUD, slider) which are added to stage later.
    const bgColor = 0x0e1726; // must match app backgroundColor
    const canvasW = this.config.canvas.width;
    const canvasH = this.config.canvas.height;
    const outerLeft   = xCenter - hw - rw;
    const outerTop    = yCenter - hh - rw;
    const outerRight  = xCenter + hw + rw;
    const outerBottom = yCenter + hh + rw;

    const cover = new Graphics();
    cover.rect(0, 0, canvasW, outerTop).fill({ color: bgColor });                              // top strip
    cover.rect(0, outerBottom, canvasW, canvasH - outerBottom).fill({ color: bgColor });       // bottom strip
    cover.rect(0, outerTop, outerLeft, outerBottom - outerTop).fill({ color: bgColor });       // left strip
    cover.rect(outerRight, outerTop, canvasW - outerRight, outerBottom - outerTop).fill({ color: bgColor }); // right strip
    this.tableContainer.addChild(cover);
  }

  /**
   * Draws the top HUD interface displaying scores, hands, and current turn indicators.
   */
  drawHUDLayout() {
    const hudHeight = 90;
    
    // Draw background glassmorphism panel
    const bg = new Graphics();
    bg.rect(0, 0, this.config.canvas.width, hudHeight);
    bg.fill({ color: 0x11192e, alpha: 0.95 });
    this.hudContainer.addChild(bg);

    // Fading gradient backgrounds behind player HUD panels but in front of base HUD bg
    this.p1GradientSprite = new Sprite(this.createGradientTexture(0x00e5ff, true));
    this.p1GradientSprite.x = 0;
    this.p1GradientSprite.y = 0;
    this.p1GradientSprite.height = hudHeight; // clamp to HUD height — avoids bleeding below HUD
    this.p1GradientSprite.alpha = 0.35; // Premium glowing visual style
    this.p1GradientSprite.visible = false;
    this.hudContainer.addChild(this.p1GradientSprite);

    this.p2GradientSprite = new Sprite(this.createGradientTexture(0xe040fb, false));
    this.p2GradientSprite.x = 512;
    this.p2GradientSprite.y = 0;
    this.p2GradientSprite.height = hudHeight; // clamp to HUD height — avoids bleeding below HUD
    this.p2GradientSprite.alpha = 0.35; // Premium glowing visual style
    this.p2GradientSprite.visible = false;
    this.hudContainer.addChild(this.p2GradientSprite);

    // Separate TextStyle instances per player so setActivePlayer() can colorize
    // each title independently without cross-contaminating the other.
    const p1TitleStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 15,
      fontWeight: 'bold',
      fill: 0xffffff,
      letterSpacing: 2
    });
    const p2TitleStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 15,
      fontWeight: 'bold',
      fill: 0xffffff,
      letterSpacing: 2
    });

    const infoStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 11,
      fill: 0x90caf9
    });

    // 1. Player 1 Info Panel
    const p1Container = new Container();
    p1Container.x = 40;
    p1Container.y = 8;
    this.p1HUDContainer = p1Container;

    const p1Title = new Text({ text: `${this.config.rules?.player1Name?.toUpperCase() || 'PLAYER 1'}`, style: p1TitleStyle });
    p1Title.x = 0;
    p1Title.y = 0;
    p1Container.addChild(p1Title);
    this.p1TitleText = p1Title; // Save title reference

    // Render 5 empty card slot outlines for Player 1
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 28, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p1Container.addChild(cardSlot);
      this.player1HandGraphics.push(cardSlot);
    }

    this.p1CardsContainer = new Container();
    this.p1CardsContainer.x = 0;
    this.p1CardsContainer.y = 28; // align with slot outlines (drawn at y=28)
    p1Container.addChild(this.p1CardsContainer);

    // Hand label (real-time poker hand rank display)
    // const p1LabelStyle = new TextStyle({
    //   fontFamily: 'Inter, Arial, sans-serif',
    //   fontSize: 10,
    //   fontWeight: 'bold',
    //   fill: 0x00e5ff,
    //   alpha: 0.9
    // });
    // const p1HandLabel = new Text({ text: '', style: p1LabelStyle });
    // p1HandLabel.x = 0;
    // p1HandLabel.y = 72;
    // p1Container.addChild(p1HandLabel);
    // this.p1HandLabel = p1HandLabel;

    this.hudContainer.addChild(p1Container);

    // 2. Player 2 Info Panel
    const p2Container = new Container();
    p2Container.x = 754; // Symmetrically aligned (1024 - 40 - 230)
    p2Container.y = 8;
    this.p2HUDContainer = p2Container;

    const p2Title = new Text({ text: `${this.config.rules?.player2Name?.toUpperCase() || 'PLAYER 2'}`, style: p2TitleStyle });
    p2Title.x = 0;
    p2Title.y = 0;
    p2Container.addChild(p2Title);
    this.p2TitleText = p2Title; // Save title reference

    // Render 5 empty card slot outlines for Player 2
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 28, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p2Container.addChild(cardSlot);
      this.player2HandGraphics.push(cardSlot);
    }

    this.p2CardsContainer = new Container();
    this.p2CardsContainer.x = 0;
    this.p2CardsContainer.y = 28; // align with slot outlines (drawn at y=28)
    p2Container.addChild(this.p2CardsContainer);

    // Hand label (real-time poker hand rank display)
    // const p2LabelStyle = new TextStyle({
    //   fontFamily: 'Inter, Arial, sans-serif',
    //   fontSize: 10,
    //   fontWeight: 'bold',
    //   fill: 0xe040fb,
    //   alpha: 0.9
    // });
    // const p2HandLabel = new Text({ text: '', style: p2LabelStyle });
    // p2HandLabel.x = 0;
    // p2HandLabel.y = 72;
    // p2Container.addChild(p2HandLabel);
    // this.p2HandLabel = p2HandLabel;

    this.hudContainer.addChild(p2Container);

    // 3. Center Status Panel (Beautiful modern reactive badge)
    const centerContainer = new Container();
    centerContainer.x = 392; // Centered exactly at (1024 - 240) / 2
    centerContainer.y = 12; // Adjusted vertically for perfect centering

    const centerBadgeBg = new Graphics();
    centerBadgeBg.roundRect(0, 0, 240, 50, 25); // Sleek glassmorphic pill shape
    centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
    centerBadgeBg.stroke({ color: 0x00e5ff, width: 1.5, alpha: 0.8 });
    centerContainer.addChild(centerBadgeBg);
    this.centerBadgeBg = centerBadgeBg;

    const activeTurnStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 11,
      fontWeight: '900',
      fill: 0xffffff,
      letterSpacing: 1.5,
      align: 'center'
    });

    this.activePlayerText = new Text({ text: `READY`, style: activeTurnStyle });
    this.activePlayerText.anchor.set(0.5);
    this.activePlayerText.x = 120; // Center of the 240px wide pill
    this.activePlayerText.y = 25; // Center of the 50px high pill
    centerContainer.addChild(this.activePlayerText);

    this.hudContainer.addChild(centerContainer);
  }

  /**
   * Draws a vector suit icon directly onto a Pixi Graphics object.
   * Every suit uses the same overall bounding box (size × size) so all four symbols
   * render at exactly the same visual weight — no font-metric inconsistencies.
   *
   * @param {Graphics} g      Target Pixi Graphics to draw into
   * @param {string}   suit   'S' | 'H' | 'D' | 'C'
   * @param {number}   cx     Center X inside g's local coordinate space
   * @param {number}   cy     Center Y inside g's local coordinate space
   * @param {number}   size   Bounding-box side length in pixels
   * @param {number}   color  Hex fill colour (0xRRGGBB)
   */
  _drawSuitIcon(g, suit, cx, cy, size, color) {
    const s = size / 2; // half-size convenience

    if (suit === 'D') {
      // Diamond — clean 4-point rhombus
      g.moveTo(cx, cy - s)
        .lineTo(cx + s * 0.72, cy)
        .lineTo(cx, cy + s)
        .lineTo(cx - s * 0.72, cy)
        .closePath()
        .fill({ color });

    } else if (suit === 'H') {
      // Heart — two circular lobes + a downward-pointing triangle
      const lr = s * 0.55;
      g.circle(cx - s * 0.30, cy - s * 0.15, lr).fill({ color });
      g.circle(cx + s * 0.30, cy - s * 0.15, lr).fill({ color });
      g.moveTo(cx - s * 0.90, cy - s * 0.10)
        .lineTo(cx + s * 0.90, cy - s * 0.10)
        .lineTo(cx, cy + s)
        .closePath()
        .fill({ color });

    } else if (suit === 'S') {
      // Spade — upward triangle + two lower lobes + a short stem + base bar
      g.moveTo(cx, cy - s)
        .lineTo(cx + s * 0.90, cy + s * 0.25)
        .lineTo(cx - s * 0.90, cy + s * 0.25)
        .closePath()
        .fill({ color });
      const lr = s * 0.50;
      g.circle(cx - s * 0.35, cy + s * 0.12, lr).fill({ color });
      g.circle(cx + s * 0.35, cy + s * 0.12, lr).fill({ color });
      // Stem
      g.moveTo(cx - s * 0.20, cy + s * 0.35)
        .lineTo(cx + s * 0.20, cy + s * 0.35)
        .lineTo(cx + s * 0.20, cy + s * 0.75)
        .lineTo(cx - s * 0.20, cy + s * 0.75)
        .closePath()
        .fill({ color });
      // Base bar
      g.moveTo(cx - s * 0.55, cy + s)
        .lineTo(cx + s * 0.55, cy + s)
        .lineTo(cx + s * 0.25, cy + s * 0.72)
        .lineTo(cx - s * 0.25, cy + s * 0.72)
        .closePath()
        .fill({ color });

    } else if (suit === 'C') {
      // Club — three equal circles + stem + base bar
      const cr = s * 0.44;
      g.circle(cx,              cy - s * 0.30, cr).fill({ color });
      g.circle(cx - s * 0.46,  cy + s * 0.22, cr).fill({ color });
      g.circle(cx + s * 0.46,  cy + s * 0.22, cr).fill({ color });
      // Stem
      g.moveTo(cx - s * 0.20, cy + s * 0.38)
        .lineTo(cx + s * 0.20, cy + s * 0.38)
        .lineTo(cx + s * 0.20, cy + s * 0.72)
        .lineTo(cx - s * 0.20, cy + s * 0.72)
        .closePath()
        .fill({ color });
      // Base bar
      g.moveTo(cx - s * 0.55, cy + s)
        .lineTo(cx + s * 0.55, cy + s)
        .lineTo(cx + s * 0.25, cy + s * 0.70)
        .lineTo(cx - s * 0.25, cy + s * 0.70)
        .closePath()
        .fill({ color });
    }
  }

  /**
   * Spawns Pixi.js sprite containers corresponding to Matter.js physical bodies
   * @param {Matter.Body} cueBall The physical cue ball
   * @param {Array<Matter.Body>} targetBalls Array of physical target balls
   */
  createBallViews(cueBall, targetBalls) {
    // Clear any previous ball containers
    this.ballContainer.removeChildren();
    this.ballViews.clear();
    this._ballSeamContainers.clear();
    this._ballRollAngles.clear();

    const { radius } = this.config.ball;

    /**
     * Builds a glossy pool-ball Pixi Container.
     * Returns { container, seamContainer } — seamContainer rotates independently
     * to create a convincing rolling animation while the rank label stays upright.
     */
    const buildBallGraphics = (color, textChar, isWildcard = false) => {
      const container = new Container();

      // ── Seam layer: rotates each frame to simulate rolling ─────────────────
      // Consists of a subtle curved line across the ball, giving the impression
      // of the ball's surface spinning as it moves.
      const seamContainer = new Container();

      const seam1 = new Graphics();
      // Curved seam line (slightly off-centre for 3D realism)
      seam1.moveTo(-radius * 0.85, -radius * 0.15);
      seam1.lineTo( radius * 0.85,  radius * 0.15);
      seam1.stroke({ color: 0x000000, alpha: 0.18, width: 1.2 });
      seamContainer.addChild(seam1);

      // Accent dot on the seam (helps show rotation clearly)
      const seamDot = new Graphics();
      seamDot.circle(radius * 0.6, radius * 0.1, 1.8);
      seamDot.fill({ color: 0x000000, alpha: 0.20 });
      seamContainer.addChild(seamDot);

      container.addChild(seamContainer);

      // ── Colored ball base circle ────────────────────────────────────────────
      const base = new Graphics();
      base.circle(0, 0, radius);
      if (isWildcard) {
        base.fill({ color: 0xffd700 });
      } else {
        base.fill({ color });
      }
      base.stroke({ color: 0x000000, width: 1.5 });
      container.addChild(base);

      // ── Inner glossy shine overlay (static — light always from upper-left) ──
      const shine = new Graphics();
      shine.circle(-radius * 0.35, -radius * 0.35, radius * 0.4);
      shine.fill({ color: 0xffffff, alpha: 0.25 });
      container.addChild(shine);

      // ── Card rank overlay (always stays upright — NOT inside seamContainer) ─
      if (textChar !== null) {
        const overlay = new Graphics();
        overlay.circle(0, 0, radius * 0.62);
        overlay.fill({ color: 0xffffff });
        container.addChild(overlay);

        const labelStyle = new TextStyle({
          fontFamily: 'Arial, sans-serif',
          fontSize: isWildcard ? 16 : 11,
          fontWeight: 'bold',
          fill: isWildcard ? 0xb58e3d : (textChar === 'A' || textChar === 'J' || textChar === 'Q' || textChar === 'K' ? 0xd32f2f : 0x212121),
          align: 'center'
        });

        const label = new Text({ text: textChar, style: labelStyle });
        label.anchor.set(0.5);
        container.addChild(label);

        // Underline decoration for 6 and 9
        if (textChar === '6' || textChar === '9') {
          const underline = new Graphics();
          underline.rect(-4, 4.5, 8, 1.5);
          underline.fill({ color: isWildcard ? 0xb58e3d : 0x212121 });
          container.addChild(underline);
        }
      }

      return { container, seamContainer };
    };

    // ── Cue Ball (white, no rank label) ──────────────────────────────────────
    const { container: cueView, seamContainer: cueSeam } = buildBallGraphics(this.config.visuals.colors.cueBall, null);
    this.ballViews.set(cueBall.id, cueView);
    this._ballSeamContainers.set(cueBall.id, cueSeam);
    this._ballRollAngles.set(cueBall.id, 0);
    this.ballContainer.addChild(cueView);

    // ── 15 target card balls ──────────────────────────────────────────────────
    const cardRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', '★', '★'];

    targetBalls.forEach((ball) => {
      const idx = ball.plugin.ballId - 1;
      const color = this.config.visuals.colors.balls[idx] || 0xffffff;
      const rankText = cardRanks[idx] || '?';
      const isWild = (idx === 13 || idx === 14);

      const { container: ballView, seamContainer: ballSeam } = buildBallGraphics(color, rankText, isWild);
      this.ballViews.set(ball.id, ballView);
      this._ballSeamContainers.set(ball.id, ballSeam);
      this._ballRollAngles.set(ball.id, 0);
      this.ballContainer.addChild(ballView);
    });

    console.log(`[RENDERER] Created ${targetBalls.length + 1} ball views with rolling seam layers`);
  }

  /**
   * Synchronizes Matter.js physical body coordinates/angles to Pixi.js sprite graphics.
   * @param {Matter.Body} cueBall The physical cue ball
   * @param {Array<Matter.Body>} targetBalls Array of physical target balls
   */
  syncPositions(cueBall, targetBalls) {
    const radius = this.config.ball.radius;
    const dt = 1 / 60; // Approximate frame time (matches Pixi ticker at 60 fps)

    /**
     * Updates a single ball view: position + rolling seam rotation.
     * The seam sub-container rotates based on accumulated linear speed so the
     * ball appears to roll realistically without requiring Matter.js angular physics.
     */
    const syncBall = (body, view) => {
      view.x = body.position.x;
      view.y = body.position.y;
      // Main container stays unrotated so the rank label is always upright
      view.rotation = 0;

      // Accumulate roll angle from linear speed (arc-length / radius)
      const vel = body.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (speed > 0.05) {
        const prev = this._ballRollAngles.get(body.id) ?? 0;
        // Roll direction: velocity angle rotated 90° (ball surface motion is perpendicular to travel)
        // For a top-down view the most natural convention is: moving right → CW rotation
        const rollDelta = speed * dt / radius;
        const newAngle = (prev + rollDelta) % (Math.PI * 2);
        this._ballRollAngles.set(body.id, newAngle);

        const seam = this._ballSeamContainers.get(body.id);
        if (seam) seam.rotation = newAngle;
      }
    };

    if (cueBall && this.ballViews.has(cueBall.id)) {
      syncBall(cueBall, this.ballViews.get(cueBall.id));
      this.ballViews.get(cueBall.id).visible = true;
    }

    targetBalls.forEach((ball) => {
      if (this.ballViews.has(ball.id)) {
        syncBall(ball, this.ballViews.get(ball.id));
      }
    });
  }

  /**
   * Dynamic helper to remove a view if a ball is pocketed/respawned
   * @param {number} bodyId The body ID of the ball
   * @param {boolean} visible Set visible state
   */
  setBallVisibility(bodyId, visible) {
    if (this.ballViews.has(bodyId)) {
      this.ballViews.get(bodyId).visible = visible;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PIXI-NATIVE BALL-IN-HAND CONFIRM BUTTON
  // Rendered inside the canvas so it scales correctly on every window size.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Shows the "Confirm Position" button as a visual Pixi element in the HUD strip.
   * Click handling is done by controls.js via handleBIHConfirmClick() so it uses
   * the same coordinate mapping as every other control (resize-proof).
   * @param {string} label Button text (e.g. "CONFIRM BREAK POSITION")
   */
  showBallInHandConfirmButton(label) {
    this.hideBallInHandConfirmButton(); // remove any stale instance

    const btn = new Container();
    btn.eventMode = 'none'; // visual only — clicks handled in controls.js

    const bg = new Graphics();
    btn.addChild(bg);

    const style = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 11,
      fontWeight: '900',
      fill: 0x001a00,
      letterSpacing: 1.5
    });
    const text = new Text({ text: label, style });
    text.anchor.set(0.5);
    btn.addChild(text);

    // Sits inside the HUD strip, centred below the active-player badge.
    // Badge occupies y=12→62; this button fills the remaining 62→85 band.
    btn.x = this.config.canvas.width / 2;
    btn.y = 78;

    const drawState = (valid) => {
      bg.clear();
      const w = 230, h = 20;
      bg.roundRect(-w / 2, -h / 2, w, h, h / 2);
      bg.fill({ color: valid ? 0x00c853 : 0x880000, alpha: valid ? 0.95 : 0.85 });
      bg.stroke({ color: valid ? 0x00e676 : 0xff5252, width: 1.5, alpha: 0.9 });
      text.text = valid ? label : '⚠ OVERLAPPING';
      text.style.fill = valid ? 0x001a00 : 0xffcccc;
      btn.alpha = valid ? 1.0 : 0.75;
    };
    drawState(true);
    btn._drawState = drawState;

    this._bihConfirmButton = btn;
    this.uiContainer.addChild(btn);
  }

  /**
   * Returns true if game-space coordinates (x, y) land on the visible BIH confirm
   * button. Called from controls.js so click routing uses getCanvasCoordinates(),
   * the same path as every other control — unaffected by CSS/Pixi scaling drift.
   */
  handleBIHConfirmClick(x, y) {
    if (!this._bihConfirmButton) return false;
    const btnCX = this.config.canvas.width / 2; // 512
    const btnCY = 78;
    const halfW = 115, halfH = 14; // generous touch target
    return Math.abs(x - btnCX) <= halfW && Math.abs(y - btnCY) <= halfH;
  }

  /**
   * Updates the visual state of the BIH confirm button (valid ↔ invalid).
   * Called from AimingControls._placeCueBallAt() on every position update.
   */
  updateBallInHandButton(valid) {
    if (this._bihConfirmButton?._drawState) {
      this._bihConfirmButton._drawState(valid);
    }
  }

  /**
   * Removes the BIH confirm button from the canvas.
   */
  hideBallInHandConfirmButton() {
    if (this._bihConfirmButton) {
      this.uiContainer.removeChild(this._bihConfirmButton);
      this._bihConfirmButton.destroy({ children: true });
      this._bihConfirmButton = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RIGHT PANEL — rules, credits, cheat toggle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Draws the permanent right-side icon column:
   *   1. "?" → How to Play (rules modal)
   *   2. "i" → Credits (opens huydung.com)
   *   3. CHEAT toggle pill
   *
   * The panel fills the narrow strip between the table's right rail and the
   * canvas edge (≈ 960–1024 px).
   */
  drawRightPanel() {
    const { yCenter, height } = this.config.table;
    // Fix panel at a constant position — 56px strip on the right edge.
    // This is intentionally NOT derived from xCenter so the panel stays put
    // regardless of table positioning, and blends with the canvas background.
    const panelX = this.config.canvas.width - 56;
    const cx = panelX + 28;   // horizontal centre of the 56px strip
    const yTop = yCenter - height / 2; // table top y ≈ 130

    const rp = this.rightPanelContainer;
    // NO background rectangle — panel blends with the canvas background colour.

    // ── Helper: circular icon button (visual only — events handled by native DOM listener)
    const makeIcon = (symbol, yPos, borderColor) => {
      const btn = new Container();
      btn.x = cx;
      btn.y = yPos;

      const circ = new Graphics();
      circ.circle(0, 0, 16);
      circ.fill({ color: 0x0d1b2e });
      circ.stroke({ color: borderColor, width: 1.5 });
      btn.addChild(circ);

      const label = new Text({
        text: symbol,
        style: new TextStyle({
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: 14,
          fontWeight: '900',
          fill: borderColor,
        })
      });
      label.anchor.set(0.5);
      btn.addChild(label);

      rp.addChild(btn);
      return { btn, circ };
    };

    // "?" — How to Play
    const { circ: qCirc } = makeIcon('?', yTop + 20, 0x00e5ff);
    // "i" — Credits
    const { circ: iCirc } = makeIcon('i', yTop + 62, 0x7ecaff);

    // ── Thin separator ────────────────────────────────────────────────────
    const sep = new Graphics();
    sep.moveTo(panelX + 6, yTop + 97).lineTo(this.config.canvas.width - 6, yTop + 97);
    sep.stroke({ color: 0x1e3a5f, width: 1 });
    rp.addChild(sep);

    // ── CHEAT toggle pill (visual only) ──────────────────────────────────
    const toggleY = yTop + 120;

    const cheatLabel = new Text({
      text: 'CHEAT',
      style: new TextStyle({
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 9,
        fontWeight: '700',
        fill: 0x6b8cae,
        letterSpacing: 1
      })
    });
    cheatLabel.anchor.set(0.5);
    cheatLabel.x = cx;
    cheatLabel.y = toggleY - 14;
    rp.addChild(cheatLabel);

    const toggleBtn = new Container();
    toggleBtn.x = cx;
    toggleBtn.y = toggleY;

    const pill = new Graphics();
    this._cheatTogglePill = pill;
    this._redrawCheatToggle(false);
    toggleBtn.addChild(pill);

    const stateText = new Text({
      text: 'OFF',
      style: new TextStyle({
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 8,
        fontWeight: '700',
        fill: 0x6b8cae,
      })
    });
    stateText.anchor.set(0.5);
    stateText.x = 0;
    stateText.y = 0;
    toggleBtn.addChild(stateText);
    this._cheatToggleLabel = stateText;

    rp.addChild(toggleBtn);

    // ── FINISH SHOT button (cheat mode — hidden by default) ───────────────
    // Lives in the right panel below the CHEAT toggle. Shown only when cheat
    // mode is active AND a ball + pocket selection has been confirmed.
    // 56px wide panel: compact two-line amber button centered on cx.
    const finishY = toggleY + 68;  // 68px below the toggle pill centre

    // Separator line above the FINISH button
    const finishSep = new Graphics();
    finishSep.moveTo(panelX + 6, finishY - 28).lineTo(this.config.canvas.width - 6, finishY - 28);
    finishSep.stroke({ color: 0x1e3a5f, width: 1 });
    rp.addChild(finishSep);

    const finishContainer = new Container();
    finishContainer.x = cx;
    finishContainer.y = finishY;
    finishContainer.visible = false;           // hidden until cheat mode needs it
    this._cheatFinishPanelBtn = finishContainer;
    this._rpFinishY = finishY;

    const finishBg = new Graphics();
    const fw = 44, fh = 36;
    finishBg.roundRect(-fw / 2, -fh / 2, fw, fh, 8);
    finishBg.fill({ color: 0xff8f00 });
    finishBg.stroke({ color: 0xffc107, width: 1.5 });
    finishContainer.addChild(finishBg);
    this._cheatFinishPanelBg = finishBg;

    const finishIcon = new Text({
      text: '⚡',
      style: new TextStyle({ fontFamily: 'Inter, Arial, sans-serif', fontSize: 13, fill: 0x1a0a00 })
    });
    finishIcon.anchor.set(0.5);
    finishIcon.x = 0;
    finishIcon.y = -9;
    finishContainer.addChild(finishIcon);

    const finishLbl = new Text({
      text: 'FINISH',
      style: new TextStyle({
        fontFamily: 'Inter, Arial, sans-serif', fontSize: 8,
        fontWeight: '900', fill: 0x1a0a00, letterSpacing: 0.5
      })
    });
    finishLbl.anchor.set(0.5);
    finishLbl.x = 0;
    finishLbl.y = 7;
    finishContainer.addChild(finishLbl);

    rp.addChild(finishContainer);

    // ── Store geometry for handleRightPanelClick() called from controls.js ──
    this._rpPanelX  = panelX;
    this._rpCx      = cx;
    this._rpYTop    = yTop;
    this._rpToggleY = toggleY;
    this._rpQCirc   = qCirc;
    this._rpICirc   = iCirc;

    console.log(`[RENDERER] Right panel drawn: panelX=${panelX} cx=${cx} yTop=${yTop} toggleY=${toggleY} finishY=${finishY}`);
  }

  /**
   * Redraws the cheat toggle pill in on/off state.
   * @param {boolean} enabled
   */
  _redrawCheatToggle(enabled) {
    const p = this._cheatTogglePill;
    if (!p) return;
    const w = 38, h = 16;
    p.clear();
    p.roundRect(-w / 2, -h / 2, w, h, h / 2);
    p.fill({ color: enabled ? 0x00c853 : 0x1a2e44 });
    p.stroke({ color: enabled ? 0x00e676 : 0x2a4460, width: 1.5 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RIGHT PANEL — click dispatcher called from main.js native DOM listener
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called by the native DOM pointerdown listener in main.js with already-
   * converted canvas coordinates (same math as controls.js getCanvasCoordinates).
   * Checks which right-panel element was hit and fires the appropriate action.
   * @param {number} x  Canvas-space x coordinate
   * @param {number} y  Canvas-space y coordinate
   */
  handleRightPanelClick(x, y) {
    const { _rpPanelX: panelX, _rpCx: cx, _rpYTop: yTop,
            _rpToggleY: toggleY, _rpQCirc: qCirc, _rpICirc: iCirc } = this;

    if (!panelX) {
      console.warn('[RENDERER] handleRightPanelClick called before drawRightPanel');
      return;
    }

    if (x < panelX) return; // safety guard (main.js also checks, but be defensive)

    const dx = x - cx;

    // "?" button — 18 px hit radius
    if (Math.sqrt(dx * dx + (y - (yTop + 20)) ** 2) <= 18) {
      console.log('[RENDERER] ? button hit');
      if (qCirc) { qCirc.tint = 0xdddddd; setTimeout(() => { qCirc.tint = 0xffffff; }, 150); }
      if (this.onRulesRequest) this.onRulesRequest();
      return;
    }

    // "i" button — 18 px hit radius
    if (Math.sqrt(dx * dx + (y - (yTop + 62)) ** 2) <= 18) {
      console.log('[RENDERER] i button hit');
      if (iCirc) { iCirc.tint = 0xdddddd; setTimeout(() => { iCirc.tint = 0xffffff; }, 150); }
      window.open('https://huydung.com', '_blank');
      return;
    }

    // CHEAT toggle pill — ±16 px vertically
    if (Math.abs(y - toggleY) <= 16) {
      this._cheatEnabled = !this._cheatEnabled;
      this._redrawCheatToggle(this._cheatEnabled);
      if (this._cheatToggleLabel) {
        this._cheatToggleLabel.text = this._cheatEnabled ? 'ON' : 'OFF';
        this._cheatToggleLabel.style.fill = this._cheatEnabled ? 0x001a00 : 0x6b8cae;
      }
      console.log(`[RENDERER] Cheat toggle → ${this._cheatEnabled ? 'ON' : 'OFF'}`);
      if (this.onCheatToggle) {
        this.onCheatToggle(this._cheatEnabled);
      } else {
        console.warn('[RENDERER] onCheatToggle not wired');
      }
      return;
    }

    // FINISH SHOT button (visible only when cheat selection is ready)
    const finishY = this._rpFinishY;
    if (finishY && this._cheatFinishPanelBtn?.visible && Math.abs(y - finishY) <= 22) {
      console.log('[RENDERER] FINISH SHOT button hit (right panel)');
      if (this._cheatFinishPanelBg) {
        this._cheatFinishPanelBg.tint = 0xdddddd;
        setTimeout(() => { if (this._cheatFinishPanelBg) this._cheatFinishPanelBg.tint = 0xffffff; }, 150);
      }
      if (this.onCheatFinishShot) this.onCheatFinishShot();
      return;
    }

    console.log(`[RENDERER] Right panel click at y=${y.toFixed(0)} — no button matched (toggleY=${toggleY} finishY=${finishY} yTop=${yTop})`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHEAT — Finish Shot button
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Shows or hides the amber "FINISH SHOT" button in the right panel.
   * The button is pre-built in drawRightPanel() and simply toggled visible.
   * It sits below the CHEAT toggle pill and is hit-tested via handleRightPanelClick.
   */
  setCheatFinishButton(visible) {
    console.log(`[CHEAT] setCheatFinishButton(${visible}) panelBtn=${!!this._cheatFinishPanelBtn}`);
    if (this._cheatFinishPanelBtn) {
      this._cheatFinishPanelBtn.visible = visible;
    }
    // Remove any legacy floating HUD button if it somehow still exists
    if (this._cheatFinishBtn) {
      this.uiContainer.removeChild(this._cheatFinishBtn);
      this._cheatFinishBtn.destroy({ children: true });
      this._cheatFinishBtn = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPIN / ENGLISH UI
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Draws the static spin/English selector: a small circle representing the cue ball
   * face with crosshairs and zone labels. The draggable indicator dot is positioned
   * by updateSpinUI() each frame. Called once from init().
   */
  /**
   * Draws the CueBallUI contact-point selector in the right panel.
   * Designed to look like a pool cue ball — solid white with a gloss highlight.
   * A red dot (drawn at local 0,0 so it can be repositioned correctly) is the
   * draggable contact-point indicator.  No text labels — icon-only design.
   */
  drawSpinUI() {
    const { x: cx, y: cy, radius: r } = this.config.spinUi;
    const c = this._spinUiContainer;
    c.removeChildren();

    // ── Outer shadow ring (gives the ball depth against dark panel) ───────────
    const shadow = new Graphics();
    shadow.circle(cx, cy, r + 2);
    shadow.fill({ color: 0x000000, alpha: 0.35 });
    c.addChild(shadow);

    // ── White cue-ball face ───────────────────────────────────────────────────
    const ball = new Graphics();
    ball.circle(cx, cy, r);
    ball.fill({ color: 0xf8f8f8 });
    ball.stroke({ color: 0xbbbbbb, width: 1 });
    c.addChild(ball);

    // ── Gloss highlight — upper-left, just like a real pool ball ─────────────
    const gloss = new Graphics();
    gloss.circle(cx - r * 0.32, cy - r * 0.32, r * 0.38);
    gloss.fill({ color: 0xffffff, alpha: 0.55 });
    c.addChild(gloss);

    // ── Hair-thin centre crosshair (barely visible reference lines) ───────────
    const cross = new Graphics();
    cross.moveTo(cx - r + 3, cy); cross.lineTo(cx + r - 3, cy);
    cross.moveTo(cx, cy - r + 3); cross.lineTo(cx, cy + r - 3);
    cross.stroke({ color: 0xaaaaaa, alpha: 0.30, width: 0.6 });
    c.addChild(cross);

    // ── Red contact-point indicator dot ──────────────────────────────────────
    // IMPORTANT: drawn at local (0,0) so dot.x / dot.y correctly position it on stage.
    const dot = new Graphics();
    dot.circle(0, 0, 5.5);
    dot.fill({ color: 0xee1111 });
    dot.stroke({ color: 0x880000, width: 1 });
    // Small inner highlight to make it look like a raised button
    dot.circle(-1.5, -1.5, 2);
    dot.fill({ color: 0xff6666, alpha: 0.6 });
    // Start at ball centre
    dot.x = cx;
    dot.y = cy;
    c.addChild(dot);
    this._spinUiDot = dot;

    console.log(`[RENDERER] CueBallUI drawn at (${cx}, ${cy}) r=${r}`);
  }

  /**
   * Moves the red contact-point dot to match the current spinOffset each frame.
   * @param {{ x: number, y: number }} spinOffset  Contact-point offset (-1..1 each axis)
   */
  updateSpinUI(spinOffset) {
    if (!this._spinUiDot) return;
    const { x: cx, y: cy, radius: r } = this.config.spinUi;
    // Keep dot inside the ball face (6 px margin from edge)
    const dotRange = r - 6;
    this._spinUiDot.x = cx + spinOffset.x * dotRange;
    this._spinUiDot.y = cy + spinOffset.y * dotRange;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHEAT — ball & pocket selection overlays
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Adds or removes a yellow selection ring around a ball in cheat mode.
   * @param {number} bodyId  Matter.js body ID
   * @param {boolean} selected
   */
  setCheatBallSelected(bodyId, selected) {
    if (!selected) {
      const ring = this._cheatBallRings.get(bodyId);
      if (ring) {
        this._cheatOverlayContainer.removeChild(ring);
        ring.destroy();
        this._cheatBallRings.delete(bodyId);
      }
      return;
    }
    if (this._cheatBallRings.has(bodyId)) return; // already shown

    const view = this.ballViews.get(bodyId);
    if (!view) return;

    const ring = new Graphics();
    const r = this.config.ball.radius + 4;
    ring.circle(0, 0, r);
    ring.stroke({ color: 0xffeb3b, width: 2.5, alpha: 0.9 });
    ring.fill({ color: 0xffeb3b, alpha: 0.12 });
    ring.x = view.x;
    ring.y = view.y;
    this._cheatBallRings.set(bodyId, ring);
    this._cheatOverlayContainer.addChild(ring);
  }

  /**
   * Adds or removes a selection glow on a pocket in cheat mode.
   * @param {number} pocketIdx  0-5 pocket index
   * @param {boolean} selected
   */
  setCheatPocketSelected(pocketIdx, selected) {
    // Remove existing overlay if any
    if (this._cheatPocketRings[pocketIdx]) {
      const existing = this._cheatPocketRings[pocketIdx];
      this._cheatOverlayContainer.removeChild(existing);
      existing.destroy();
      this._cheatPocketRings[pocketIdx] = null;
    }
    if (!selected) return;

    const pg = this.pocketGraphics[pocketIdx];
    if (!pg) return;

    const ring = new Graphics();
    ring.circle(0, 0, this.config.pocket.radius + 5);
    ring.stroke({ color: 0xffeb3b, width: 3, alpha: 1.0 });
    ring.fill({ color: 0xffeb3b, alpha: 0.2 });
    ring.x = pg.container.x;
    ring.y = pg.container.y;
    this._cheatPocketRings[pocketIdx] = ring;
    this._cheatOverlayContainer.addChild(ring);
  }

  /**
   * Clears all cheat selection rings (balls and pockets).
   */
  clearCheatSelections() {
    this._cheatBallRings.forEach((ring) => {
      this._cheatOverlayContainer.removeChild(ring);
      ring.destroy();
    });
    this._cheatBallRings.clear();

    this._cheatPocketRings.forEach((ring) => {
      if (ring) {
        this._cheatOverlayContainer.removeChild(ring);
        ring.destroy();
      }
    });
    this._cheatPocketRings = [];
  }

  /**
   * Syncs cheat ball ring positions to current ball positions each frame.
   * Called from main.js ticker after syncPositions.
   */
  syncCheatOverlays() {
    this._cheatBallRings.forEach((ring, bodyId) => {
      const view = this.ballViews.get(bodyId);
      if (view) { ring.x = view.x; ring.y = view.y; }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Appends a full-width coloured overlay div that sweeps across the HUD
   * to signal a player switch. Automatically removes itself after the
   * CSS animation completes (~600 ms).
   * @param {string} toPlayer Name of the incoming active player
   */
  _triggerHudSweep(toPlayer) {
    const container = this.containerElement || document.getElementById('game-container');
    if (!container) return;

    const sweep = document.createElement('div');
    const isP1 = toPlayer === this.player1Name;
    sweep.className = isP1 ? 'hud-sweep sweep-left' : 'hud-sweep';

    // Colour the sweep bar to match the incoming player
    const color = isP1 ? 'rgba(0, 229, 255, 0.45)' : 'rgba(224, 64, 251, 0.45)';
    sweep.style.background = `linear-gradient(90deg, transparent, ${color}, transparent)`;

    container.appendChild(sweep);

    // Clean up once animation ends (~600 ms)
    sweep.addEventListener('animationend', () => sweep.remove(), { once: true });
  }

  setActivePlayer(name) {
    // Detect genuine player switch and fire the sweep animation
    if (this._lastActivePlayer && this._lastActivePlayer !== name) {
      this._triggerHudSweep(name);
    }
    this._lastActivePlayer = name;

    this.activePlayerName = name;
    if (this.activePlayerText) {
      const themeColor = name === this.player1Name ? 0x00e5ff : 0xe040fb;
      
      // Lock countdown indicator check
      if (this.gameRef && this.gameRef.lockCountdownActive && this.gameRef.lockedPlayer) {
        const locked = this.gameRef.lockedPlayer;
        const opponent = locked === this.player1Name ? this.player2Name : this.player1Name;
        const countdown = this.gameRef.lockCountdown;
        this.activePlayerText.text = `🔒 ${locked.toUpperCase()} LOCKED\n(${opponent}: ${countdown} left)`;
      } else {
        this.activePlayerText.text = `${name.toUpperCase()}\n(Drag=Aim / Slide=Shoot)`;
      }

      if (this.centerBadgeBg) {
        this.centerBadgeBg.clear();
        this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
        this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
        this.centerBadgeBg.stroke({ color: themeColor, width: 1.5, alpha: 0.8 });
      }
      this.activePlayerText.style.fill = themeColor;
    }

    if (this.p1HUDContainer && this.p2HUDContainer) {
      // Keep both panels clean at full opacity (1.0) at all times
      this.p1HUDContainer.alpha = 1.0;
      this.p2HUDContainer.alpha = 1.0;
      
      if (name === this.player1Name) {
        // Player 1 Active
        if (this.p1GradientSprite) this.p1GradientSprite.visible = true;
        if (this.p2GradientSprite) this.p2GradientSprite.visible = false;
        
        if (this.p1TitleText) this.p1TitleText.style.fill = 0x00e5ff; // colorful
        if (this.p2TitleText) this.p2TitleText.style.fill = 0xffffff; // white
      } else {
        // Player 2 Active
        if (this.p1GradientSprite) this.p1GradientSprite.visible = false;
        if (this.p2GradientSprite) this.p2GradientSprite.visible = true;
        
        if (this.p1TitleText) this.p1TitleText.style.fill = 0xffffff; // white
        if (this.p2TitleText) this.p2TitleText.style.fill = 0xe040fb; // colorful
      }
    }
  }

  /**
   * Renders the dedicated glassmorphic power slider on the left edge of the viewport.
   * @param {boolean} isDragging True if the user is actively dragging the slider
   * @param {number} dragRatio Capped pullback ratio between 0.0 and 1.0
   */
  drawPowerSlider(isDragging, dragRatio) {
    this.sliderGraphics.clear();

    const s = this.config.slider;
    if (!s) return;

    // 1. Sleek Glassmorphic Background Panel
    this.sliderGraphics.roundRect(s.x, s.y, s.width, s.height, 8);
    this.sliderGraphics.fill({ color: 0x0f172a, alpha: 0.75 });
    this.sliderGraphics.stroke({
      color: isDragging ? 0xffb300 : 0x22355c,
      width: isDragging ? 2.5 : 1.5,
      alpha: 0.95
    });

    // 2. Groove Track Line (centered)
    const trackWidth = 6;
    const trackX = s.x + s.width / 2 - trackWidth / 2;
    const trackY = s.y + 20;
    const trackHeight = s.height - 40;

    this.sliderGraphics.roundRect(trackX, trackY, trackWidth, trackHeight, 3);
    this.sliderGraphics.fill({ color: 0x1e293b });

    // 3. Glowing neon power fill (growing down representing pullback)
    if (dragRatio > 0) {
      const filledHeight = trackHeight * dragRatio;
      this.sliderGraphics.roundRect(trackX, trackY, trackWidth, filledHeight, 3);
      
      // Cyber glow color gradient
      let powerColor = 0x00e5ff; // Neon cyan at low power
      if (dragRatio > 0.5) powerColor = 0xffeb3b; // Yellow at medium power
      if (dragRatio > 0.85) powerColor = 0xff1744; // Bright neon red at full force

      this.sliderGraphics.fill({ color: powerColor });
    }

    // 4. Polished Metallic Accent Slider Handle
    const handleY = trackY + trackHeight * dragRatio;
    const handleX = s.x + s.width / 2;
    const handleRadius = 13;

    // Handle soft shadow glow
    this.sliderGraphics.circle(handleX, handleY, handleRadius + 2.5);
    this.sliderGraphics.fill({ color: isDragging ? 0xffb300 : 0x00e5ff, alpha: 0.3 });

    // Handle outer metallic border
    this.sliderGraphics.circle(handleX, handleY, handleRadius);
    this.sliderGraphics.fill({ color: 0x334155 });
    this.sliderGraphics.stroke({ color: isDragging ? 0xffb300 : 0x64748b, width: 2 });

    // Handle shiny glossy center core
    this.sliderGraphics.circle(handleX, handleY, 5.5);
    this.sliderGraphics.fill({ color: isDragging ? 0xffeb3b : 0xffffff });
  }

  /**
   * Renders the interactive cue stick stroke dragging and aiming assist laser.
   * Draw the deflection path, deflection target lines and contact ghost ball.
   * @param {Object} aimData Coordinates and paths calculated by controls.js
   */
  drawAimLine(aimData) {
    this.aimGraphics.clear();

    if (this.gameRef && this.gameRef.controls && this.gameRef.controls.hasBallInHand) {
      if (this.activePlayerText) {
        this.activePlayerText.text = "BALL IN HAND\n(Drag Cue Ball)";
        if (this.centerBadgeBg) {
          this.centerBadgeBg.clear();
          this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
          this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
          this.centerBadgeBg.stroke({ color: 0x00e676, width: 2, alpha: 0.9 });
        }
        this.activePlayerText.style.fill = 0x00e676;
      }
      
      const cueBall = this.gameRef.controls.physics.cueBall;
      if (cueBall) {
        // Draw pulsing green ring around cue ball position
        const startX = cueBall.position.x;
        const startY = cueBall.position.y;
        const pulse = 1 + Math.sin(Date.now() / 150) * 0.15;
        const radius = this.config.ball.radius * pulse;
        
        // Outer glowing ring
        this.aimGraphics.circle(startX, startY, radius + 6);
        this.aimGraphics.stroke({
          color: 0x00e676,
          width: 3,
          alpha: 0.8
        });

        // Inner glowing ring
        this.aimGraphics.circle(startX, startY, radius + 2);
        this.aimGraphics.stroke({
          color: 0x00e676,
          width: 1.5,
          alpha: 0.4
        });
      }
      return;
    }

    if (!aimData) {
      if (this.activePlayerText) {
        this.activePlayerText.text = "BALLS ROLLING...";
        if (this.centerBadgeBg) {
          this.centerBadgeBg.clear();
          this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
          this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
          this.centerBadgeBg.stroke({ color: 0x1e293b, width: 1.5, alpha: 0.8 });
        }
        this.activePlayerText.style.fill = 0x94a3b8;
      }
      return;
    }

    const { startX, startY, strokeDir, powerRatio, isAiming } = aimData;
    const visuals = this.config.visuals.aiming;

    // Update HUD center text
    if (this.activePlayerText) {
      const themeColor = this.activePlayerName === this.player1Name ? 0x00e5ff : 0xe040fb;
      this.activePlayerText.text = `${this.activePlayerName.toUpperCase()}\n(Drag=Aim / Slide=Shoot)`;
      if (this.centerBadgeBg) {
        this.centerBadgeBg.clear();
        this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
        this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
        this.centerBadgeBg.stroke({ color: isAiming ? 0xffd700 : themeColor, width: isAiming ? 2 : 1.5, alpha: 0.9 });
      }
      this.activePlayerText.style.fill = isAiming ? 0xffd700 : themeColor;
    }

    // A. Draw the solid interactive cue stick pointing towards the cue ball
    // Extended backward opposite of aim direction
    const dragRatio = powerRatio;
    const visualOffset = this.config.cue.visualOffset ?? 25;
    const pullBackDistance = this.config.cue.pullBackDistance ?? 80;
    const cueOffset = visualOffset + dragRatio * pullBackDistance; // Dynamic custom pull-back effect distance
    const cueLength = 260;

    const stickX = startX - strokeDir.x * cueOffset;
    const stickY = startY - strokeDir.y * cueOffset;
    const endStickX = stickX - strokeDir.x * cueLength;
    const endStickY = stickY - strokeDir.y * cueLength;

    // Draw pool cue body wood graphic
    this.aimGraphics.moveTo(stickX, stickY);
    this.aimGraphics.lineTo(endStickX, endStickY);
    this.aimGraphics.stroke({
      color: 0xddcaaa, // Raw elegant cue wood color
      width: 5,
      cap: 'round'
    });

    // Draw the cue tip (brass + leather wrap)
    const tipLength = 15;
    const tipX = startX - strokeDir.x * (cueOffset - tipLength);
    const tipY = startY - strokeDir.y * (cueOffset - tipLength);
    this.aimGraphics.moveTo(stickX, stickY);
    this.aimGraphics.lineTo(tipX, tipY);
    this.aimGraphics.stroke({
      color: 0x3e2723, // Warm dark tip wrap
      width: 5
    });

    // Draw glowing ring around cue ball while actively dragging
    if (isAiming) {
      this.aimGraphics.circle(startX, startY, this.config.ball.radius + 4);
      this.aimGraphics.stroke({
        color: 0xffd700,
        width: 2,
        alpha: 0.8
      });
    }

    // C. Draw Aiming Laser Assist — dashed line to ghost ball only (no deflection lines, no pocket glow)
    const laserColor = isAiming ? 0x00e5ff : visuals.laserColor;
    const laserWidth = isAiming ? 2.5 : 2;
    const laserAlpha = isAiming ? 0.9 : visuals.laserAlpha;
    const infiniteLaserWidth = isAiming ? 2.5 : 1.5;
    const infiniteLaserAlpha = isAiming ? 0.9 : 0.3;

    if (aimData.hasHit && aimData.ghostCenter) {
      const { ghostCenter } = aimData;

      // Draw dashed line from cue ball center to the ghost ball contact position
      this.drawDashedLine(
        startX, startY,
        ghostCenter.x, ghostCenter.y,
        laserColor, laserWidth, 10, 6, laserAlpha
      );

      // Draw ghost cue ball outline at the exact contact point
      this.aimGraphics.circle(ghostCenter.x, ghostCenter.y, this.config.ball.radius);
      this.aimGraphics.stroke({
        color: isAiming ? 0x00e5ff : visuals.ghostColor,
        width: 1.5,
        alpha: isAiming ? 0.9 : visuals.ghostAlpha
      });
    } else {
      // No hit — draw a long dashed helper line in the aim direction
      const longEndX = startX + strokeDir.x * 400;
      const longEndY = startY + strokeDir.y * 400;
      this.drawDashedLine(
        startX, startY,
        longEndX, longEndY,
        laserColor, infiniteLaserWidth, 10, 6, infiniteLaserAlpha
      );
    }
  }


  /**
   * Custom helper to draw vector dashed lines in Pixi.js
   */
  drawDashedLine(x1, y1, x2, y2, color, width, dashLen, gapLen, alpha = 1.0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    const steps = dist / (dashLen + gapLen);
    const xStep = (dx / dist) * (dashLen + gapLen);
    const yStep = (dy / dist) * (dashLen + gapLen);
    
    this.aimGraphics.moveTo(x1, y1);

    for (let i = 0; i < steps; i++) {
      const curX = x1 + i * xStep;
      const curY = y1 + i * yStep;
      
      this.aimGraphics.moveTo(curX, curY);
      this.aimGraphics.lineTo(
        curX + (dx / dist) * dashLen,
        curY + (dy / dist) * dashLen
      );
      this.aimGraphics.stroke({
        color: color,
        width: width,
        alpha: alpha
      });
    }
  }

  /**
   * Redraws pocket rims and suit symbols when suits are claimed or converted to wild pockets.
   * @param {Array<string|null>} pocketSuits Pocket mappings array of length 6
   */
  updatePocketGraphics(pocketSuits) {
    this.pocketSuits = pocketSuits;

    this.pocketGraphics.forEach((g, idx) => {
      const suit = pocketSuits[idx];
      g.suitContainer.removeChildren();

      // Determine rim stroke color based on suit mapping
      let color = this.config.visuals.colors.pocketBorder || 0x424242; // default unmapped
      let glowColor = this.config.visuals.pockets.unclaimed || 0xffeb3b; // default unclaimed yellow
      let glowAlpha = 0.2; // default unclaimed glow alpha

      if (suit !== null) {
        glowAlpha = 0.1; // dim representation for active state
        if (suit === 'W') {
          color = 0xffd700; // Gold for Wild
          glowColor = 0xffd700;
        } else if (suit === 'S') {
          color = 0x00e5ff; // Neon Cyan
          glowColor = 0x00e5ff;
        } else if (suit === 'H') {
          color = 0xff1744; // Neon Red
          glowColor = 0xff1744;
        } else if (suit === 'D') {
          color = 0xff9100; // Neon Orange
          glowColor = 0xff9100;
        } else if (suit === 'C') {
          color = 0x00e676; // Neon Green
          glowColor = 0x00e676;
        }
      }

      // Redraw the rim border
      g.rim.clear();
      g.rim.circle(0, 0, this.config.pocket.radius + 1);
      g.rim.stroke({ color: color, width: 3 });
      g.rim.circle(0, 0, this.config.pocket.radius);
      g.rim.fill({ color: this.config.visuals.colors.pocketBg || 0x11192e });

      // Redraw the glow indicator statically representing state
      g.glow.clear();
      g.glow.circle(0, 0, this.config.pocket.radius + 3);
      g.glow.fill({ color: glowColor, alpha: glowAlpha });

      // Draw suit symbol inside pocket — vector paths for the four card suits,
      // text for the wildcard star (which has no distortion issue).
      if (suit !== null) {
        if (suit === 'W') {
          const style = new TextStyle({
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: 18,
            fontWeight: 'bold',
            fill: color
          });
          const star = new Text({ text: '★', style });
          star.anchor.set(0.5);
          star.x = 0;
          star.y = 0;
          g.suitContainer.addChild(star);
        } else {
          const suitG = new Graphics();
          this._drawSuitIcon(suitG, suit, 0, 0, 18, color);
          g.suitContainer.addChild(suitG);
        }
      }
    });
  }

  /**
   * Returns a text label describing the best partial hand type from 2–5 cards.
   * Shows nothing for 0–1 cards; shows full evaluation for 5 cards.
   * @param {Array} hand Array of card objects {rank, suit}
   * @returns {string} Label string or empty string
   */
  _getPartialHandLabel(hand) {
    if (!hand || hand.length === 0) return '';
    // evaluatePokerHand now supports 1–5 cards natively
    const ev = evaluatePokerHand(hand);
    // Append "(in progress)" for hands under 5 cards to signal they're still building
    return hand.length < 5 ? `${ev.label} (in progress)` : ev.label;
  }



  /**
   * Renders a styled mini card graphic on the HUD player panels.
   */
  renderCardOnHUD(container, card, idx, themeColor = 0x213359) {
    const cardView = new Container();
    cardView.x = idx * 40;

    // White backdrop
    const base = new Graphics();
    base.roundRect(0, 0, 32, 46, 4);
    base.fill({ color: 0xffffff });
    base.stroke({ color: themeColor, width: 1.5 });
    cardView.addChild(base);

    // Text details (rank and suit symbol)
    const rankStr = card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : card.rank.toString();
    const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
    const suitStr = suitSymbols[card.suit] || '';

    const isRed = card.suit === 'H' || card.suit === 'D';
    const fillStyle = isRed ? 0xd32f2f : 0x212121;

    // Rank: top-third of card, centred
    const rankStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 13,
      fontWeight: 'bold',
      fill: fillStyle
    });

    const rankText = new Text({ text: rankStr, style: rankStyle });
    rankText.anchor.set(0.5);
    rankText.x = 16;
    rankText.y = 14;
    cardView.addChild(rankText);

    // Draw horizontal underline for 6 and 9 mini-cards on HUD
    if (rankStr === '6' || rankStr === '9') {
      const underline = new Graphics();
      underline.rect(10, 21, 12, 1.5);
      underline.fill({ color: fillStyle });
      cardView.addChild(underline);
    }

    // Suit: vector icon drawn at fixed size — identical bounding box for all four suits
    const suitG = new Graphics();
    this._drawSuitIcon(suitG, card.suit, 16, 32, 13, fillStyle);
    cardView.addChild(suitG);

    container.addChild(cardView);
  }

  /**
   * Synchronizes HUD display of player cards, consecutive miss counters, and turn active labels.
   */
  updateHUD(hands, activePlayer, discardTokens) {
    // 1. Clear card containers
    if (this.p1CardsContainer) this.p1CardsContainer.removeChildren();
    if (this.p2CardsContainer) this.p2CardsContainer.removeChildren();

    const p1Hand = hands[this.player1Name] || [];
    const p2Hand = hands[this.player2Name] || [];

    // 2. Render cards
    if (this.p1CardsContainer) {
      p1Hand.forEach((card, idx) => {
        this.renderCardOnHUD(this.p1CardsContainer, card, idx, 0x00e5ff); // Cyan border for P1 Alice
      });
    }

    if (this.p2CardsContainer) {
      p2Hand.forEach((card, idx) => {
        this.renderCardOnHUD(this.p2CardsContainer, card, idx, 0xe040fb); // Purple border for P2 Bob
      });
    }

    // 5. Update the turn text
    this.setActivePlayer(activePlayer);
  }
}
