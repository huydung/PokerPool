/**
 * centralized configuration for Poker Pool
 * Contains all physical constants, dimensions, rules, and visuals.
 * NON-CODERS can edit this file to balance and tune the gameplay sandbox.
 */
export const CONFIG = {
  // ==========================================
  // SCREEN & CANVAS DIMENSIONS
  // ==========================================
  
  canvas: {
    /** @type {number} Fixed viewport width in pixels for deterministic physics calculations */
    width: 1024,
    /** @type {number} Fixed viewport height in pixels */
    height: 576
  },

  // ==========================================
  // PHYSICAL TABLE LAYOUT
  // ==========================================
  
  table: {
    /** @type {number} Width of the play area inside the cushions (2:1 ratio) */
    width: 800,
    /** @type {number} Height of the play area inside the cushions (2:1 ratio) */
    height: 400,
    /** @type {number} Center coordinate along X-axis */
    xCenter: 512,
    /** @type {number} Center coordinate along Y-axis (offset down to leave room for HUD) */
    yCenter: 336,
    /** @type {number} Thickness of the rails in pixels */
    railWidth: 30,
    /** @type {number} Coefficient of restitution for rails (bounce bounciness, 0 to 1) */
    railRestitution: 0.8,
    /** @type {number} Alias for railRestitution to satisfy TDD test specifications */
    cushionRestitution: 0.8
  },

  // ==========================================
  // POCKET PROPERTIES
  // ==========================================
  
  pocket: {
    /** @type {number} Radius of the pocket sensors in pixels */
    radius: 25,
    /** @type {number} Collision buffer/offset to place side pockets slightly outward */
    sideOffset: 5
  },

  // ==========================================
  // BALL PROPERTIES (MATTER.JS RIGID BODIES)
  // ==========================================
  
  ball: {
    /** @type {number} Radius of all pool balls in pixels */
    radius: 15,
    /** @type {number} Density of the ball body (g/cm^2 scale, higher = heavier/momentum) */
    density: 0.0016,
    /** @type {number} Alias for density parameter to satisfy exact tuning guidelines */
    ballDensity: 0.0016,
    /** @type {number} Elastic bounce coefficient for ball-to-ball collisions (0.95 = highly elastic) */
    restitution: 0.95,
    /** @type {number} Alias for restitution bounciness to satisfy exact tuning guidelines */
    ballRestitution: 0.95,
    /** @type {number} Surface sliding friction coefficient (table felt resistance) */
    friction: 0.015,
    /** @type {number} Alias for surface felt sliding friction to satisfy tuning guidelines */
    tableFriction: 0.015,
    /** @type {number} Air resistance / damping coefficient (slows balls down naturally) */
    frictionAir: 0.012,
    /** @type {number} Maximum speed a ball can travel (clamp to prevent tunneling / high-speed glitches) */
    maxSpeed: 20,
    /** @type {number} Alias for maxSpeed to satisfy tuning guidelines */
    maxBallSpeed: 20,
    /** @type {number} Global time scale of the physics simulation (1.0 = normal speed) */
    timeScale: 1.0
  },

  // ==========================================
  // CUE STICK & INTERACTIVE DRAGGING CONTROLS
  // ==========================================
  
  cue: {
    /** @type {number} Maximum force applied to the cue ball on a full stroke */
    maxForce: 0.1,
    /** @type {number} Drag sensitivity multiplier (scales mouse delta to impulse) */
    dragScale: 0.0008,
    /** @type {number} Minimum drag distance in pixels to register a shot */
    minDrag: 10,
    /** @type {number} Maximum drag distance in pixels to cap shot force */
    maxDrag: 150
  },

  // ==========================================
  // VISUAL STYLE & AESTHETIC PALETTE (KENNEY STYLE)
  // ==========================================
  
  visuals: {
    colors: {
      /** @type {number} Rich blue felt color (matching gameref.png) */
      felt: 0x1e88e5,
      /** @type {number} Dark wooden rail border color */
      rail: 0x3e2723,
      /** @type {number} Solid cushion rim color */
      cushion: 0x1565c0,
      /** @type {number} Sensory pocket background circle color */
      pocketBg: 0x111111,
      /** @type {number} Color of the head string line */
      headString: 0x64b5f6,
      /** @type {number} Pure white cue ball fill */
      cueBall: 0xffffff,
      
      // Target Balls Colors (Kenney Board Game Palette)
      balls: [
        0xe53935, // 1: Red
        0x1e88e5, // 2: Blue
        0x43a047, // 3: Green
        0xfb8c00, // 4: Orange
        0x8e24aa, // 5: Purple
        0xfdd835, // 6: Yellow
        0x3949ab, // 7: Indigo
        0x00acc1, // 8: Cyan
        0xd81b60, // 9: Pink
        0x00897b, // 10: Teal
        0x7cb342, // 11: Light Green
        0xf06292, // 12: Soft Red
        0x5e35b1, // 13: Deep Purple
        0xffb300, // 14: Metallic Gold (Wildcard 1)
        0xffb300  // 15: Metallic Gold (Wildcard 2)
      ]
    },
    
    aiming: {
      /** @type {number} Color of the active laser ray pointer */
      laserColor: 0xffffff,
      /** @type {number} Opacity of the active laser ray */
      laserAlpha: 0.6,
      /** @type {number} Color of the ghost cue ball outline */
      ghostColor: 0xffffff,
      /** @type {number} Opacity of the ghost cue ball outline */
      ghostAlpha: 0.4,
      /** @type {number} Color of the target deflection path line */
      targetDeflectColor: 0x4caf50,
      /** @type {number} Color of the cue deflection path line */
      cueDeflectColor: 0xffeb3b
    },

    pockets: {
      // Glow indicators for diagnostic states
      /** @type {number} Color of unmapped/unclaimed pockets (Phase 1) */
      unclaimed: 0xffeb3b, // Yellow
      /** @type {number} Color when a pocket scores a valid new card */
      valid: 0x4caf50, // Green
      /** @type {number} Color when a shot would result in a duplicate/invalid drop */
      invalid: 0xf44336 // Red
    }
  }
};
