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
    this.p1Hearts = [];
    this.p2Hearts = [];
    this.p1HandLabel = null;
    this.p2HandLabel = null;

    // Laser overlay graphics
    this.aimGraphics = new Graphics();

    // Slider overlay graphics
    this.sliderGraphics = new Graphics();

    // Callback fired when the Stand button is clicked.
    // Set by GameEngine.startMatch — avoids renderer reaching into gameRef for this action.
    this.onStandRequested = null;

    // Active Player Turn Name tracking
    this.player1Name = this.config.rules?.player1Name || 'Alice';
    this.player2Name = this.config.rules?.player2Name || 'Bob';
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
    this.app.stage.addChild(this.hudContainer);
    this.app.stage.addChild(this.sliderGraphics); // Top-level glassmorphic slider overlay

    this.aimContainer.addChild(this.aimGraphics);

    this.drawTableLayout();
    this.drawHUDLayout();
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
   * Helper to draw a mathematically precise, beautiful, symmetrical vector heart centered at (x, y)
   */
  drawHeart(graphics, x, y, size) {
    graphics.clear();
    const halfSize = size / 2;

    graphics.moveTo(x, y - size * 0.2);
    // Left lobe
    graphics.bezierCurveTo(x - size * 0.3, y - size * 0.6, x - halfSize, y - size * 0.3, x - halfSize, y + size * 0.05);
    graphics.bezierCurveTo(x - halfSize, y + size * 0.35, x - size * 0.25, y + halfSize, x, y + halfSize);
    // Right lobe
    graphics.bezierCurveTo(x + size * 0.25, y + halfSize, x + halfSize, y + size * 0.35, x + halfSize, y + size * 0.05);
    graphics.bezierCurveTo(x + halfSize, y - size * 0.3, x + size * 0.3, y - size * 0.6, x, y - size * 0.2);

    graphics.fill({ color: 0xffffff });
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
  }

  /**
   * Draws the top HUD interface displaying scores, hands, and current turn indicators.
   */
  drawHUDLayout() {
    const hudHeight = 100;
    
    // Draw background glassmorphism panel
    const bg = new Graphics();
    bg.rect(0, 0, this.config.canvas.width, hudHeight);
    bg.fill({ color: 0x11192e, alpha: 0.95 });
    this.hudContainer.addChild(bg);

    // Fading gradient backgrounds behind player HUD panels but in front of base HUD bg
    this.p1GradientSprite = new Sprite(this.createGradientTexture(0x00e5ff, true));
    this.p1GradientSprite.x = 0;
    this.p1GradientSprite.y = 0;
    this.p1GradientSprite.alpha = 0.35; // Premium glowing visual style
    this.p1GradientSprite.visible = false;
    this.hudContainer.addChild(this.p1GradientSprite);

    this.p2GradientSprite = new Sprite(this.createGradientTexture(0xe040fb, false));
    this.p2GradientSprite.x = 512;
    this.p2GradientSprite.y = 0;
    this.p2GradientSprite.alpha = 0.35; // Premium glowing visual style
    this.p2GradientSprite.visible = false;
    this.hudContainer.addChild(this.p2GradientSprite);

    const titleStyle = new TextStyle({
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

    const p1Title = new Text({ text: `${this.config.rules?.player1Name?.toUpperCase() || 'ALICE'}`, style: titleStyle });
    p1Title.x = 0;
    p1Title.y = 0;
    p1Container.addChild(p1Title);
    this.p1TitleText = p1Title; // Save title reference

    // Heart slots for P1 misses
    for (let i = 0; i < 3; i++) {
      const heart = new Graphics();
      this.drawHeart(heart, 0, 0, 14);
      heart.tint = 0xff1744;
      heart.x = 142 + i * 18;
      heart.y = 8;
      p1Container.addChild(heart);
      this.p1Hearts.push(heart);
    }

    const p1Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p1Score.y = 20;
    p1Container.addChild(p1Score);
    this.player1ScoreText = p1Score;

    // Render 5 empty card slot outlines for Player 1
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 42, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p1Container.addChild(cardSlot);
      this.player1HandGraphics.push(cardSlot);
    }

    this.p1CardsContainer = new Container();
    this.p1CardsContainer.x = 0;
    this.p1CardsContainer.y = 42;
    p1Container.addChild(this.p1CardsContainer);

    // Hand label (real-time poker hand rank display)
    const p1LabelStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 10,
      fontWeight: 'bold',
      fill: 0x00e5ff,
      alpha: 0.9
    });
    const p1HandLabel = new Text({ text: '', style: p1LabelStyle });
    p1HandLabel.x = 0;
    p1HandLabel.y = 90;
    p1Container.addChild(p1HandLabel);
    this.p1HandLabel = p1HandLabel;

    this.hudContainer.addChild(p1Container);

    // 2. Player 2 Info Panel
    const p2Container = new Container();
    p2Container.x = 754; // Symmetrically aligned (1024 - 40 - 230)
    p2Container.y = 8;
    this.p2HUDContainer = p2Container;

    const p2Title = new Text({ text: `${this.config.rules?.player2Name?.toUpperCase() || 'BOB'}`, style: titleStyle });
    p2Title.x = 0;
    p2Title.y = 0;
    p2Container.addChild(p2Title);
    this.p2TitleText = p2Title; // Save title reference

    // Heart slots for P2 misses
    for (let i = 0; i < 3; i++) {
      const heart = new Graphics();
      this.drawHeart(heart, 0, 0, 14);
      heart.tint = 0xff1744;
      heart.x = 142 + i * 18;
      heart.y = 8;
      p2Container.addChild(heart);
      this.p2Hearts.push(heart);
    }

    const p2Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p2Score.y = 20;
    p2Container.addChild(p2Score);
    this.player2ScoreText = p2Score;

    // Render 5 empty card slot outlines for Player 2
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 42, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p2Container.addChild(cardSlot);
      this.player2HandGraphics.push(cardSlot);
    }

    this.p2CardsContainer = new Container();
    this.p2CardsContainer.x = 0;
    this.p2CardsContainer.y = 42;
    p2Container.addChild(this.p2CardsContainer);

    // Hand label (real-time poker hand rank display)
    const p2LabelStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 10,
      fontWeight: 'bold',
      fill: 0xe040fb,
      alpha: 0.9
    });
    const p2HandLabel = new Text({ text: '', style: p2LabelStyle });
    p2HandLabel.x = 0;
    p2HandLabel.y = 90;
    p2Container.addChild(p2HandLabel);
    this.p2HandLabel = p2HandLabel;

    this.hudContainer.addChild(p2Container);

    // 3. Center Status Panel (Beautiful modern reactive badge)
    const centerContainer = new Container();
    centerContainer.x = 392; // Centered exactly at (1024 - 240) / 2
    centerContainer.y = 25; // Adjusted vertically for perfect centering

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
   * Spawns Pixi.js sprite containers corresponding to Matter.js physical bodies
   * @param {Matter.Body} cueBall The physical cue ball
   * @param {Array<Matter.Body>} targetBalls Array of physical target balls
   */
  createBallViews(cueBall, targetBalls) {
    // Clear any previous ball containers
    this.ballContainer.removeChildren();
    this.ballViews.clear();

    const { radius } = this.config.ball;

    // 1. Helper to render a glossy 3D pool ball
    const buildBallGraphics = (color, textChar, isWildcard = false) => {
      const container = new Container();

      // Colored ball base circle
      const base = new Graphics();
      base.circle(0, 0, radius);
      
      if (isWildcard) {
        // Metallic Gold Gradient feel
        base.fill({ color: 0xffd700 });
      } else {
        base.fill({ color: color });
      }
      base.stroke({ color: 0x000000, width: 1.5 }); // Distinct black outline around all balls
      container.addChild(base);

      // Inner glossy shine overlay
      const shine = new Graphics();
      shine.circle(-radius * 0.35, -radius * 0.35, radius * 0.4);
      shine.fill({ color: 0xffffff, alpha: 0.25 });
      container.addChild(shine);

      // Card Rank overlay circle & text (if not cue ball)
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
        label.x = 0;
        label.y = 0;
        container.addChild(label);

        // Add visual underline decoration for 6 and 9 pool balls on the table felt
        if (textChar === '6' || textChar === '9') {
          const underline = new Graphics();
          underline.rect(-4, 4.5, 8, 1.5);
          underline.fill({ color: isWildcard ? 0xb58e3d : 0x212121 });
          container.addChild(underline);
        }
      }

      return container;
    };

    // 2. Render Cue Ball (Solid White, Glossy, No Overlay text)
    const cueView = buildBallGraphics(this.config.visuals.colors.cueBall, null);
    this.ballViews.set(cueBall.id, cueView);
    this.ballContainer.addChild(cueView);

    // 3. Render 15 target card balls
    const cardRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', '★', '★'];
    
    targetBalls.forEach((ball) => {
      const idx = ball.plugin.ballId - 1;
      const color = this.config.visuals.colors.balls[idx] || 0xffffff;
      const rankText = cardRanks[idx] || '?';
      const isWild = (idx === 13 || idx === 14);

      const ballView = buildBallGraphics(color, rankText, isWild);
      this.ballViews.set(ball.id, ballView);
      this.ballContainer.addChild(ballView);
    });
  }

  /**
   * Synchronizes Matter.js physical body coordinates/angles to Pixi.js sprite graphics.
   * @param {Matter.Body} cueBall The physical cue ball
   * @param {Array<Matter.Body>} targetBalls Array of physical target balls
   */
  syncPositions(cueBall, targetBalls) {
    if (cueBall && this.ballViews.has(cueBall.id)) {
      const view = this.ballViews.get(cueBall.id);
      view.x = cueBall.position.x;
      view.y = cueBall.position.y;
      view.rotation = cueBall.angle;
      // Show/Hide based on existence/sinking
      view.visible = true;
    }

    targetBalls.forEach((ball) => {
      if (this.ballViews.has(ball.id)) {
        const view = this.ballViews.get(ball.id);
        view.x = ball.position.x;
        view.y = ball.position.y;
        view.rotation = ball.angle;
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
      
      // Stand countdown indicator check
      if (this.gameRef && this.gameRef.standingPlayer) {
        const standing = this.gameRef.standingPlayer;
        const opponent = standing === this.player1Name ? this.player2Name : this.player1Name;
        const countdown = this.gameRef.standCountdown;
        this.activePlayerText.text = `${standing.toUpperCase()} STOOD\n(${opponent}: ${countdown} shots left)`;
      } else {
        this.activePlayerText.text = `${name.toUpperCase()}\n(Aim & Shoot)`;
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

    const { startX, startY, strokeDir, powerRatio, isLocked } = aimData;
    const visuals = this.config.visuals.aiming;

    // Update HUD center text based on lock state
    if (this.activePlayerText) {
      if (isLocked) {
        this.activePlayerText.text = "AIM LOCKED\n(Pull Slider)";
        if (this.centerBadgeBg) {
          this.centerBadgeBg.clear();
          this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
          this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
          this.centerBadgeBg.stroke({ color: 0xffd700, width: 2, alpha: 0.9 });
        }
        this.activePlayerText.style.fill = 0xffd700;
      } else {
        const themeColor = this.activePlayerName === this.player1Name ? 0x00e5ff : 0xe040fb;
        this.activePlayerText.text = `${this.activePlayerName.toUpperCase()}\n(Aim & Shoot)`;
        if (this.centerBadgeBg) {
          this.centerBadgeBg.clear();
          this.centerBadgeBg.roundRect(0, 0, 240, 50, 25);
          this.centerBadgeBg.fill({ color: 0x080f21, alpha: 0.85 });
          this.centerBadgeBg.stroke({ color: themeColor, width: 1.5, alpha: 0.8 });
        }
        this.activePlayerText.style.fill = themeColor;
      }
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

    // B. Draw Shot Power Bar underneath the HUD
    const strokeForceRatio = powerRatio;
    this.aimGraphics.rect(20, 105, 1024 - 40, 6);
    this.aimGraphics.fill({ color: 0x1c2b42 });
    
    this.aimGraphics.rect(20, 105, (1024 - 40) * strokeForceRatio, 6);
    // Green -> Yellow -> Red power gradient coloring
    let powerColor = 0x4caf50;
    if (strokeForceRatio > 0.5) powerColor = 0xffeb3b;
    if (strokeForceRatio > 0.85) powerColor = 0xf44336;
    this.aimGraphics.fill({ color: powerColor });

    // Draw glowing ring around start coordinates (cue ball position) if locked
    if (isLocked) {
      this.aimGraphics.circle(startX, startY, this.config.ball.radius + 4);
      this.aimGraphics.stroke({
        color: 0x00e5ff,
        width: 2,
        alpha: 0.8
      });
    }

    // C. Draw Aiming Laser Assist — dashed line to ghost ball only (no deflection lines, no pocket glow)
    const laserColor = isLocked ? 0x00e5ff : visuals.laserColor;
    const laserWidth = isLocked ? 2.5 : 2;
    const laserAlpha = isLocked ? 0.9 : visuals.laserAlpha;
    const infiniteLaserWidth = isLocked ? 2.5 : 1.5;
    const infiniteLaserAlpha = isLocked ? 0.9 : 0.3;

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
        color: isLocked ? 0x00e5ff : visuals.ghostColor,
        width: 1.5,
        alpha: isLocked ? 0.9 : visuals.ghostAlpha
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

      // Draw suit symbol / star text inside pocket
      if (suit !== null) {
        const symbols = { S: '♠', H: '♥', D: '♦', C: '♣', W: '★' };
        const symbolText = symbols[suit] || '';

        const style = new TextStyle({
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: 18,
          fontWeight: 'bold',
          fill: color
        });

        const text = new Text({ text: symbolText, style: style });
        text.anchor.set(0.5);
        text.x = 0;
        text.y = 0;
        g.suitContainer.addChild(text);
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
    if (!hand || hand.length < 2) return '';
    if (hand.length === 5) {
      const ev = evaluatePokerHand(hand);
      return ev.label;
    }
    // Partial hand: detect pairs, two pair, and flush potential
    const counts = {};
    hand.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    const vals = Object.values(counts).sort((a, b) => b - a);
    const isFlushDraw = hand.every(c => c.suit === hand[0].suit);
    if (vals[0] === 4) return 'Four of a Kind (in progress)';
    if (vals[0] === 3 && vals[1] === 2) return 'Full House (in progress)';
    if (vals[0] === 3) return 'Three of a Kind (in progress)';
    if (vals[0] === 2 && vals[1] === 2) return 'Two Pair (in progress)';
    if (vals[0] === 2) {
      const rankNames = { 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings' };
      const pairRank = Object.entries(counts).find(([, v]) => v === 2)?.[0];
      return `Pair of ${rankNames[pairRank] || (pairRank + 's')}`;
    }
    if (isFlushDraw) return 'Flush Draw';
    return 'High Card';
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

    const rankStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 12,
      fontWeight: 'bold',
      fill: fillStyle
    });

    const rankText = new Text({ text: rankStr, style: rankStyle });
    rankText.anchor.set(0.5);
    rankText.x = 16;
    rankText.y = 15;
    cardView.addChild(rankText);

    // Draw horizontal underline for 6 and 9 mini-cards on HUD
    if (rankStr === '6' || rankStr === '9') {
      const underline = new Graphics();
      underline.rect(11, 21, 10, 1.5);
      underline.fill({ color: fillStyle });
      cardView.addChild(underline);
    }

    const suitStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 16,
      fontWeight: 'bold',
      fill: fillStyle
    });

    const suitText = new Text({ text: suitStr, style: suitStyle });
    suitText.anchor.set(0.5);
    suitText.x = 16;
    suitText.y = 31;
    cardView.addChild(suitText);

    container.addChild(cardView);
  }

  /**
   * Synchronizes HUD display of player cards, consecutive miss counters, and turn active labels.
   */
  updateHUD(hands, activePlayer, consecutiveMisses) {
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

    // 3. Update text headers with cards count and current misses
    const p1Misses = consecutiveMisses[this.player1Name] || 0;
    const p2Misses = consecutiveMisses[this.player2Name] || 0;

    if (this.player1ScoreText) {
      this.player1ScoreText.text = `Hand Cards (${p1Hand.length}/5)`;
    }

    if (this.player2ScoreText) {
      this.player2ScoreText.text = `Hand Cards (${p2Hand.length}/5)`;
    }

    // 3a. Update real-time poker hand label below card slots
    if (this.p1HandLabel) {
      this.p1HandLabel.text = this._getPartialHandLabel(p1Hand);
    }

    if (this.p2HandLabel) {
      this.p2HandLabel.text = this._getPartialHandLabel(p2Hand);
    }

    // Update hearts indicators for misses (3-miss rule)
    for (let i = 0; i < 3; i++) {
      if (this.p1Hearts[i]) {
        if (i < 3 - p1Misses) {
          this.p1Hearts[i].tint = 0xff1744; // Active bright red
          this.p1Hearts[i].alpha = 1.0;
        } else {
          this.p1Hearts[i].tint = 0x334155; // Missed dark slate
          this.p1Hearts[i].alpha = 0.3;
        }
      }
    }

    for (let i = 0; i < 3; i++) {
      if (this.p2Hearts[i]) {
        if (i < 3 - p2Misses) {
          this.p2Hearts[i].tint = 0xff1744; // Active bright red
          this.p2Hearts[i].alpha = 1.0;
        } else {
          this.p2Hearts[i].tint = 0x334155; // Missed dark slate
          this.p2Hearts[i].alpha = 0.3;
        }
      }
    }

    // 4. Danger border — light up when active player is on their last heart
    const maxMisses = this.config.rules?.maxConsecutiveMisses ?? 3;
    const activeMisses = consecutiveMisses[activePlayer] || 0;
    const inDanger = activeMisses >= maxMisses - 1; // 1 heart left
    con