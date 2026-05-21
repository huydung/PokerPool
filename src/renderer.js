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
    const hudHeight = 136;
    
    // Draw background glassmorphism panel
    const bg = new Graphics();
    bg.rect(0, 0, this.config.canvas.width, hudHeight);
    bg.fill({ color: 0x11192e, alpha: 0.95 });
    bg.stroke({ color: 0x22355c, width: 2 });
    this.hudContainer.addChild(bg);

    const titleStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 20,
      fontWeight: 'bold',
      fill: 0xffffff,
      letterSpacing: 2
    });

    const infoStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 13,
      fill: 0x90caf9
    });

    // 1. Player 1 Info Panel (Alice)
    const p1Container = new Container();
    p1Container.x = 40;
    p1Container.y = 15;

    const p1Title = new Text({ text: 'SUSAN (PLAYER 1)', style: titleStyle });
    p1Container.addChild(p1Title);

    const p1Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p1Score.y = 28;
    p1Container.addChild(p1Score);

    // Render 5 empty card slot outlines for Player 1
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 45, 52, 38, 54, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p1Container.addChild(cardSlot);
      this.player1HandGraphics.push(cardSlot);
    }
    this.hudContainer.addChild(p1Container);

    // 2. Player 2 Info Panel (Brian)
    const p2Container = new Container();
    p2Container.x = 660;
    p2Container.y = 15;

    const p2Title = new Text({ text: 'BRIAN (PLAYER 2)', style: titleStyle });
    p2Container.addChild(p2Title);

    const p2Score = new Text({ text: 'Hand Cards (0/5):', style: infoStyle });
    p2Score.y = 28;
    p2Container.addChild(p2Score);

    // Render 5 empty card slot outlines for Player 2
    for (let i = 0; i < 5; i++) {
      const cardSlot = new Graphics();
      cardSlot.roundRect(i * 45, 52, 38, 54, 4);
      cardSlot.fill({ color: 0x0b0f19, alpha: 0.6 });
      cardSlot.stroke({ color: 0x213359, width: 1.5 });
      p2Container.addChild(cardSlot);
      this.player2HandGraphics.push(cardSlot);
    }
    this.hudContainer.addChild(p2Container);

    // 3. Center Status Panel (Turn indicator)
    const centerContainer = new Container();
    centerContainer.x = 440;
    centerContainer.y = 20;

    const activeTurnStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 16,
      fontWeight: 'bold',
      fill: 0xffb300,
      align: 'center'
    });

    this.activePlayerText = new Text({ text: 'TURN: SUSAN\n(Click & Drag to Aim)', style: activeTurnStyle });
    this.activePlayerText.x = 72 - this.activePlayerText.width / 2;
    centerContainer.addChild(this.activePlayerText);

    const separator = new Graphics();
    separator.roundRect(30, 60, 84, 28, 4);
    separator.fill({ color: 0xffb300, alpha: 0.1 });
    separator.stroke({ color: 0xffb300, width: 1.5 });
    
    const vsStyle = new TextStyle({
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 12,
      fontWeight: 'bold',
      fill: 0xffb300
    });
    const vsText = new Text({ text: 'SANDBOX', style: vsStyle });
    vsText.x = 72 - vsText.width / 2;
    vsText.y = 66;
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
        base.stroke({ color: 0xb58e3d, width: 1.5 });
      } else {
        base.fill({ color: color });
      }
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
   * Renders the interactive cue stick stroke dragging and aiming assist laser.
   * Draw the deflection path, deflection target lines and contact ghost ball.
   * @param {Object} aimData Coordinates and paths calculated by controls.js
   */
  drawAimLine(aimData) {
    this.aimGraphics.clear();

    if (!aimData || !aimData.isAiming) return;

    const { startX, startY, strokeDir, dragDist } = aimData;
    const { maxDrag, cue } = this.config.cue;
    const visuals = this.config.visuals.aiming;

    // A. Draw the solid interactive cue stick pointing towards the cue ball
    // Extended backward opposite of aim direction
    const dragRatio = Math.min(dragDist / maxDrag, 1.0);
    const cueOffset = 25 + dragRatio * 40; // Pull-back effect distance
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
    const strokeForceRatio = Math.min(dragDist / maxDrag, 1.0);
    this.aimGraphics.rect(20, 145, 1024 - 40, 6);
    this.aimGraphics.fill({ color: 0x1c2b42 });
    
    this.aimGraphics.rect(20, 145, (1024 - 40) * strokeForceRatio, 6);
    // Green -> Yellow -> Red power gradient coloring
    let powerColor = 0x4caf50;
    if (strokeForceRatio > 0.5) powerColor = 0xffeb3b;
    if (strokeForceRatio > 0.85) powerColor = 0xf44336;
    this.aimGraphics.fill({ color: powerColor });

    // C. Draw Aiming Laser Assist paths if raycast hit is registered
    if (aimData.hasHit && aimData.hitPoint) {
      const { hitPoint, ghostCenter, targetDeflect, cueDeflect } = aimData;

      // 1. Draw dashed line from cue ball center to the ghost ball position
      this.drawDashedLine(
        startX, startY,
        ghostCenter.x, ghostCenter.y,
        visuals.laserColor, 2, 10, 6, visuals.laserAlpha
      );

      // 2. Draw ghost cue ball at the exact contact point
      this.aimGraphics.circle(ghostCenter.x, ghostCenter.y, this.config.ball.radius);
      this.aimGraphics.stroke({
        color: visuals.ghostColor,
        width: 1.5,
        alpha: visuals.ghostAlpha
      });

      // 3. Draw dashed line for target ball projected deflection direction
      if (targetDeflect) {
        const targetEndX = ghostCenter.x + targetDeflect.x * 120;
        const targetEndY = ghostCenter.y + targetDeflect.y * 120;
        this.drawDashedLine(
          ghostCenter.x, ghostCenter.y,
          targetEndX, targetEndY,
          visuals.targetDeflectColor, 2, 8, 5, 0.9
        );
      }

      // 4. Draw dashed line for cue ball projected deflection direction
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
        visuals.laserColor, 1.5, 10, 6, 0.3
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
