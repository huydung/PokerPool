import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CONFIG } from './config.js';

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
    
    // HUD element references
    this.player1HandGraphics = [];
    this.player2HandGraphics = [];
    this.activePlayerText = null;

    // Laser overlay graphics
    this.aimGraphics = new Graphics();

    // Slider overlay graphics
    this.sliderGraphics = new Graphics();
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

      this.pocketGraphics.push({ container: pocketView, glow, rim, type: pos.type });
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
    bg.stroke({ color: 0x22355c, width: 2 });
    this.hudContainer.addChild(bg);

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

    // 1. Player 1 Info Panel (Alice)
    const p1Container = new Container();
    p1Container.x = 40;
    p1Container.y = 8;

    const p1Title = new Text({ text: 'SUSAN (PLAYER 1)', style: titleStyle });
    p1Container.addChild(p1Title);

    const p1Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p1Score.y = 20;
    p1Container.addChild(p1Score);

    // Render 5 empty card slot outlines for Player 1
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 42, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p1Container.addChild(cardSlot);
      this.player1HandGraphics.push(cardSlot);
    }
    this.hudContainer.addChild(p1Container);

    // 2. Player 2 Info Panel (Brian)
    const p2Container = new Container();
    p2Container.x = 780;
    p2Container.y = 8;

    const p2Title = new Text({ text: 'BRIAN (PLAYER 2)', style: titleStyle });
    p2Container.addChild(p2Title);

    const p2Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p2Score.y = 20;
    p2Container.addChild(p2Score);

    // Render 5 empty card slot outlines for Player 2
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 40, 42, 32, 46, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p2Container.addChild(cardSlot);
      this.player2HandGraphics.push(cardSlot);
    }
    this.hudContainer.addChild(p2Container);

    // 3. Center Status Panel (Turn indicator)
    const centerContainer = new Container();
    centerContainer.x = 440;
    centerContainer.y = 10;

    const activeTurnStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 13,
      fontWeight: 'bold',
      fill: 0xffb300,
      align: 'center'
    });

    this.activePlayerText = new Text({ text: 'TURN: SUSAN\n(Click & Drag to Aim)', style: activeTurnStyle });
    this.activePlayerText.x = 72 - this.activePlayerText.width / 2;
    centerContainer.addChild(this.activePlayerText);

    const separator = new Graphics();
    separator.roundRect(36, 50, 72, 24, 4);
    separator.fill({ color: 0xffb300, alpha: 0.1 });
    separator.stroke({ color: 0xffb300, width: 1.5 });
    
    const vsStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 10,
      fontWeight: 'bold',
      fill: 0xffb300
    });
    const vsText = new Text({ text: 'SANDBOX', style: vsStyle });
    vsText.x = 72 - vsText.width / 2;
    vsText.y = 54;
    centerContainer.addChild(separator, vsText);

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

    if (!aimData) {
      if (this.activePlayerText) {
        this.activePlayerText.text = "TURN: SUSAN\n(Balls Rolling...)";
        this.activePlayerText.x = 72 - this.activePlayerText.width / 2;
      }
      return;
    }

    const { startX, startY, strokeDir, powerRatio, isLocked } = aimData;
    const visuals = this.config.visuals.aiming;

    // Update HUD center text based on lock state
    if (this.activePlayerText) {
      if (isLocked) {
        this.activePlayerText.text = "AIM LOCKED!\n(Drag Slider to Shoot • Click to Unlock)";
      } else {
        this.activePlayerText.text = "TURN: SUSAN\n(Move Mouse to Aim • Click to Lock)";
      }
      this.activePlayerText.x = 72 - this.activePlayerText.width / 2;
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

    // C. Draw Aiming Laser Assist paths if raycast hit is registered
    const laserColor = isLocked ? 0x00e5ff : visuals.laserColor;
    const laserWidth = isLocked ? 2.5 : 2;
    const laserAlpha = isLocked ? 0.9 : visuals.laserAlpha;
    const infiniteLaserWidth = isLocked ? 2.5 : 1.5;
    const infiniteLaserAlpha = isLocked ? 0.9 : 0.3;

    if (aimData.hasHit && aimData.ghostCenter) {
      const { ghostCenter, targetCenter, targetDeflect, cueDeflect } = aimData;

      // 1. Draw dashed line from cue ball center to the ghost ball position
      this.drawDashedLine(
        startX, startY,
        ghostCenter.x, ghostCenter.y,
        laserColor, laserWidth, 10, 6, laserAlpha
      );

      // 2. Draw ghost cue ball at the exact contact point
      this.aimGraphics.circle(ghostCenter.x, ghostCenter.y, this.config.ball.radius);
      this.aimGraphics.stroke({
        color: isLocked ? 0x00e5ff : visuals.ghostColor,
        width: 1.5,
        alpha: isLocked ? 0.9 : visuals.ghostAlpha
      });

      // 3. Draw dashed line for target ball projected deflection direction (starting from target ball center)
      if (targetDeflect && targetCenter) {
        const targetEndX = targetCenter.x + targetDeflect.x * 120;
        const targetEndY = targetCenter.y + targetDeflect.y * 120;
        this.drawDashedLine(
          targetCenter.x, targetCenter.y,
          targetEndX, targetEndY,
          visuals.targetDeflectColor, 2, 8, 5, 0.9
        );
      }

      // 4. Draw dashed line for cue ball projected deflection direction (starting from ghost contact center)
      if (cueDeflect) {
        const cueEndX = ghostCenter.x + cueDeflect.x * 90;
        const cueEndY = ghostCenter.y + cueDeflect.y * 90;
        this.drawDashedLine(
          ghostCenter.x, ghostCenter.y,
          cueEndX, cueEndY,
          visuals.cueDeflectColor, 2, 8, 5, 0.8
        );
      }
    } else {
      // Draw infinite/long aiming helper dashed line since no hit registered
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
    
    const dashRatio = dashLen / (dashLen + gapLen);
    
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
}
