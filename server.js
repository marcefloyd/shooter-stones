const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const ROUND_DURATION = 4 * 60 * 1000;
const PHASE_DURATION = 60 * 1000;
const ESCAPE_WINDOW_DURATION = 5 * 1000;

const FIELD = {
  minX: -33.5,
  maxX: 33.5,
  minZ: -52.5,
  maxZ: 52.5
};
const STARTING_ZONE_RADIUS = Math.hypot(FIELD.maxX, FIELD.maxZ);
const CENTER_SAFE_RADIUS = 9.15;
const players = new Map();
const grenades = new Map();
const rifles = new Map();
const pistols = new Map();
const knives = new Map();
const ZONE_LENGTH = (FIELD.maxZ - FIELD.minZ) / 6;
let roundStartedAt = null;
let roundEndedAt = null;
let lastObservedPhase = 0;
let matchMode = null;

function createPlayer(id, position, yaw, isAI = false) {
  return {
    id,
    position,
    yaw,
    phaseSide: position.z < 0 ? -1 : 1,
    crouching: false,
    aiming: false,
    grenadeCount: 0,
    health: 100,
    hasKnife: false,
    knifeEquipped: false,
    weaponType: null,
    weaponAmmo: 0,
    lastShotAt: 0,
    lastGrenadeThrowAt: 0,
    lastKnifeAt: 0,
    lastWeaponDropAt: 0,
    isAI,
    nextAiActionAt: 0
  };
}

for (const zoneIndex of [0, 5]) {
  const centerZ = FIELD.minZ + ZONE_LENGTH * (zoneIndex + 0.5);
  [-8, 0, 8].forEach((zOffset, row) => {
    [-22, 0, 22].forEach((x, column) => {
      const id = `grenade-${zoneIndex}-${row}-${column}`;
      grenades.set(id, {
        id,
        position: { x, y: 0, z: centerZ + zOffset }
      });
    });
  });
}

for (const zoneIndex of [1, 4]) {
  const centerZ = FIELD.minZ + ZONE_LENGTH * (zoneIndex + 0.5);
  [-18, 0, 18].forEach((x, slot) => {
    const id = `rifle-${zoneIndex}-${slot}`;
    rifles.set(id, {
      id,
      position: { x, y: 0, z: centerZ + (slot - 1) * 3 }
    });
  });
}

for (const zoneIndex of [2, 3]) {
  const centerZ = zoneIndex === 2 ? -14 : 14;
  [-20, -10, 0, 10, 20].forEach((x, slot) => {
    const id = `pistol-${zoneIndex}-${slot}`;
    pistols.set(id, { id, position: { x, y: 0, z: centerZ } });
  });
}

for (const [slot, z] of [-3.8, 3.8].entries()) {
  const id = `knife-${slot}`;
  knives.set(id, { id, position: { x: 0, y: 0, z } });
}
const initialPickups = {
  grenades: Array.from(grenades.values()),
  rifles: Array.from(rifles.values()),
  pistols: Array.from(pistols.values()),
  knives: Array.from(knives.values())
};

function getRoundState(now = Date.now()) {
  if (roundStartedAt === null) {
    return {
      startedAt: null,
      phase: 0,
      remainingMs: ROUND_DURATION,
      phaseRemainingMs: PHASE_DURATION,
      escapeOpen: false,
      safeRadius: STARTING_ZONE_RADIUS,
      ended: false
    };
  }

  const elapsed = Math.max(0, now - roundStartedAt);
  const cappedElapsed = Math.min(elapsed, ROUND_DURATION);
  const phase = Math.min(4, Math.floor(cappedElapsed / PHASE_DURATION) + 1);
  const phaseRemainingMs =
    phase === 4
      ? Math.max(0, ROUND_DURATION - elapsed)
      : PHASE_DURATION - (cappedElapsed % PHASE_DURATION);
  return {
    startedAt: roundStartedAt,
    phase,
    remainingMs: Math.max(0, ROUND_DURATION - elapsed),
    phaseRemainingMs,
    escapeOpen:
      phase >= 1 &&
      phase <= 3 &&
      phaseRemainingMs <= ESCAPE_WINDOW_DURATION,
    safeRadius: STARTING_ZONE_RADIUS,
    ended: roundEndedAt !== null
  };
}

function getPlayerZoneBounds(player, zoneIndex) {
  const side = player.phaseSide;
  const minZ =
    side < 0
      ? FIELD.minZ + ZONE_LENGTH * zoneIndex
      : FIELD.maxZ - ZONE_LENGTH * (zoneIndex + 1);
  return { minZ, maxZ: minZ + ZONE_LENGTH };
}

function isInsidePhaseZone(player, position, phase) {
  if (phase === 4) {
    return Math.hypot(position.x, position.z) <= CENTER_SAFE_RADIUS;
  }
  const { minZ, maxZ } = getPlayerZoneBounds(player, phase - 1);
  const insideLane = position.z >= minZ && position.z <= maxZ;
  return (
    insideLane &&
    (phase !== 3 ||
      Math.hypot(position.x, position.z) > CENTER_SAFE_RADIUS)
  );
}

function constrainPlayerToPhase(player, position, phase, escapeOpen = false) {
  const constrained = {
    x: Math.max(FIELD.minX, Math.min(FIELD.maxX, position.x)),
    y: Math.max(0, Math.min(4, position.y)),
    z: Math.max(FIELD.minZ, Math.min(FIELD.maxZ, position.z))
  };
  if (phase < 1 || isInsidePhaseZone(player, constrained, phase)) {
    return constrained;
  }

  if (escapeOpen && phase < 3 && isInsidePhaseZone(player, constrained, phase + 1)) {
    return constrained;
  }
  if (escapeOpen && phase === 3 && isInsidePhaseZone(player, constrained, 4)) {
    return constrained;
  }

  const { minZ, maxZ } = getPlayerZoneBounds(player, phase - 1);
  constrained.z = Math.max(minZ, Math.min(maxZ, constrained.z));
  if (
    phase === 3 &&
    Math.hypot(constrained.x, constrained.z) <= CENTER_SAFE_RADIUS
  ) {
    const safeOffset = Math.sqrt(
      Math.max(0, CENTER_SAFE_RADIUS ** 2 - constrained.x ** 2)
    );
    constrained.z = Math.max(
      minZ,
      Math.min(
        maxZ,
        player.phaseSide < 0 ? -safeOffset - 0.1 : safeOffset + 0.1
      )
    );
  }
  return constrained;
}

function isInSafeZone(player, now = Date.now()) {
  return (
    Math.hypot(player.position.x, player.position.z) <=
    getRoundState(now).safeRadius
  );
}

function emitRoundState() {
  io.emit("round:state", getRoundState());
}

function finishRound() {
  if (roundEndedAt !== null || roundStartedAt === null) {
    return;
  }
  roundEndedAt = Date.now();
  const standings = Array.from(players.values()).map(({ id, health }) => ({
    id,
    health
  }));
  const winner =
    standings.length < 2
      ? standings[0]?.id || null
      : standings[0].health === standings[1].health
        ? null
        : standings[0].health > standings[1].health
          ? standings[0].id
          : standings[1].id;
  io.emit("round:ended", { winner, standings });
  emitRoundState();
}

function damagePlayer(player, amount, source, attackerId = null) {
  if (!player || player.health <= 0 || roundEndedAt !== null) {
    return;
  }
  player.health = Math.max(0, player.health - amount);
  io.emit("player:health", {
    id: player.id,
    health: player.health,
    source,
    attackerId
  });
  if (player.health === 0) {
    finishRound();
  }
}

function eliminatePlayer(player, phase) {
  if (!player || player.health <= 0) {
    return false;
  }
  player.health = 0;
  io.emit("player:health", {
    id: player.id,
    health: 0,
    source: "phase",
    attackerId: null
  });
  io.emit("player:eliminated", {
    id: player.id,
    position: player.position,
    phase
  });
  return true;
}

function throwGrenade(player, direction) {
  const now = Date.now();
  if (
    !player ||
    player.health <= 0 ||
    roundEndedAt !== null ||
    getRoundState().phase !== 1 ||
    player.grenadeCount < 1 ||
    now - player.lastGrenadeThrowAt < 500 ||
    !direction ||
    !Number.isFinite(direction.x) ||
    !Number.isFinite(direction.y) ||
    !Number.isFinite(direction.z)
  ) {
    return false;
  }
  const horizontalLength = Math.hypot(direction.x, direction.z);
  if (horizontalLength < 0.001) {
    return false;
  }

  player.lastGrenadeThrowAt = now;
  player.grenadeCount -= 1;
  const id = `${player.id}-${now}`;
  const grenade = {
    id,
    position: {
      x: player.position.x,
      y: player.position.y + 1.35,
      z: player.position.z
    },
    velocity: {
      x: (direction.x / horizontalLength) * 29,
      y: 18 + Math.max(-0.25, Math.min(0.25, direction.y)) * 6,
      z: (direction.z / horizontalLength) * 29
    },
    detonateAt: now + 4000
  };

  if (!player.isAI) {
    io.to(player.id).emit("grenade:inventory", { count: player.grenadeCount });
  }
  io.emit("grenade:thrown", grenade);
  setTimeout(() => {
    const position = predictGrenadeImpact(grenade);
    for (const target of players.values()) {
      if (
        Math.hypot(
          target.position.x - position.x,
          target.position.z - position.z
        ) <= 6
      ) {
        damagePlayer(target, 60, "grenade", player.id);
      }
    }
    io.emit("grenade:exploded", { id, position });
  }, 4000);
  return true;
}

function moveAiToward(bot, target, delta) {
  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 1.6) {
    const step = Math.min(distance - 1.6, 4.2 * delta);
    bot.position.x += (dx / distance) * step;
    bot.position.z += (dz / distance) * step;
    const state = getRoundState();
    bot.position = constrainPlayerToPhase(
      bot,
      bot.position,
      state.phase,
      state.escapeOpen
    );
    bot.yaw = Math.atan2(-dx, -dz);
    io.emit("player:moved", {
      id: bot.id,
      position: bot.position,
      yaw: bot.yaw,
      crouching: false
    });
  }
  return distance;
}

function nearestPickup(map, bot, safeRadius) {
  let closest = null;
  let closestDistance = Infinity;
  for (const pickup of map.values()) {
    if (
      Math.hypot(pickup.position.x, pickup.position.z) > safeRadius
    ) {
      continue;
    }
    const distance = Math.hypot(
      bot.position.x - pickup.position.x,
      bot.position.z - pickup.position.z
    );
    if (distance < closestDistance) {
      closest = pickup;
      closestDistance = distance;
    }
  }
  return closest;
}

function collectAiPickup(bot, map, pickup, type) {
  if (!pickup) {
    return;
  }
  map.delete(pickup.id);
  if (type === "grenade") {
    bot.weaponType = "bazooka";
    bot.weaponAmmo = 1;
    bot.knifeEquipped = false;
    io.emit("weapon:picked", { id: pickup.id, playerId: bot.id, type: "bazooka", ammo: 1 });
    io.emit("grenade:picked", { id: pickup.id, playerId: bot.id });
    return;
  }
  if (type === "knife") {
    bot.hasKnife = true;
    bot.knifeEquipped = true;
    io.emit("knife:picked", {
      id: pickup.id,
      playerId: bot.id,
      knifeEquipped: true
    });
    return;
  }
  bot.weaponType = type;
  bot.weaponAmmo = pickup.ammo || (type === "rifle" ? 30 : type === "pistol" ? 12 : 1);
  bot.knifeEquipped = false;
  io.emit("weapon:picked", {
    id: pickup.id,
    playerId: bot.id,
    type,
    ammo: bot.weaponAmmo
  });
}

function aiFireAtTarget(bot, target, now) {
  const fireDelay = bot.weaponType === "bazooka" ? 700 : bot.weaponType === "pistol" ? 650 : 500;
  if (now - bot.lastShotAt < fireDelay || bot.weaponAmmo < 1) {
    return;
  }
  const offset = {
    x: target.position.x - bot.position.x,
    y: target.position.y + 1 - (bot.position.y + 1.25),
    z: target.position.z - bot.position.z
  };
  const magnitude = Math.hypot(offset.x, offset.y, offset.z);
  if (magnitude < 0.001) {
    return;
  }
  const direction = {
    x: offset.x / magnitude,
    y: offset.y / magnitude,
    z: offset.z / magnitude
  };
  bot.lastShotAt = now;
  bot.weaponAmmo -= 1;
  const firedType = bot.weaponType;
  if (bot.weaponAmmo === 0) {
    bot.weaponType = null;
    bot.knifeEquipped = bot.hasKnife;
  }
  io.emit("player:shot", {
    id: bot.id,
    position: bot.position,
    yaw: bot.yaw,
    crouching: false,
    ammo: bot.weaponAmmo,
    weaponType: firedType,
    knifeEquipped: bot.knifeEquipped,
    direction
  });
  if (magnitude < 42) {
    damagePlayer(target, firedType === "bazooka" ? 100 : firedType === "pistol" ? 16 : 12, firedType, bot.id);
  }
}

function updateAiOpponent(now, delta, roundState) {
  const bot = players.get("ai-opponent");
  if (!bot || bot.health <= 0 || roundEndedAt !== null) {
    return;
  }
  const target = Array.from(players.values()).find(
    (player) => !player.isAI && player.health > 0
  );
  if (!target || now < bot.nextAiActionAt) {
    return;
  }
  bot.nextAiActionAt = now + 100;

  if (roundState.phase === 1) {
    if (bot.weaponAmmo === 0) {
      const bazooka = nearestPickup(grenades, bot, roundState.safeRadius);
      if (bazooka && moveAiToward(bot, bazooka.position, delta) < 3) {
        collectAiPickup(bot, grenades, bazooka, "grenade");
      }
    } else {
      const distance = moveAiToward(bot, target.position, delta);
      if (distance < 38) {
        aiFireAtTarget(bot, target, now);
      }
    }
  } else if (roundState.phase === 2 || roundState.phase === 3) {
    const hasGun = bot.weaponAmmo > 0;
    if (!hasGun) {
      const map = roundState.phase === 2 ? rifles : pistols;
      const type = roundState.phase === 2 ? "rifle" : "pistol";
      const pickup = nearestPickup(map, bot, roundState.safeRadius);
      if (pickup) {
        if (moveAiToward(bot, pickup.position, delta) < 3.5) {
          collectAiPickup(bot, map, pickup, type);
        }
      } else {
        moveAiToward(bot, target.position, delta);
      }
    } else {
      const distance = moveAiToward(bot, target.position, delta);
      if (distance < 38) {
        aiFireAtTarget(bot, target, now);
      }
    }
    if (roundState.phase === 3 && !bot.hasKnife) {
      const knife = nearestPickup(knives, bot, CENTER_SAFE_RADIUS);
      if (knife && moveAiToward(bot, knife.position, delta) < 3.2) {
        collectAiPickup(bot, knives, knife, "knife");
      }
    }
  } else {
    moveAiToward(bot, target.position, delta);
    if (bot.hasKnife && bot.knifeEquipped) {
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 2.4 && now - bot.lastKnifeAt >= 900) {
        bot.lastKnifeAt = now;
        damagePlayer(target, 45, "knife", bot.id);
        io.emit("knife:swung", { id: bot.id });
      }
    } else if (bot.weaponAmmo > 0) {
      aiFireAtTarget(bot, target, now);
    }
  }
}

function predictGrenadeImpact(grenade) {
  const position = { ...grenade.position };
  const velocity = { ...grenade.velocity };
  const step = 0.025;
  for (let elapsed = 0; elapsed < 4; elapsed += step) {
    if (velocity.y === 0 && position.y <= 0.38) {
      continue;
    }
    velocity.y -= 9.8 * step;
    position.x += velocity.x * step;
    position.y += velocity.y * step;
    position.z += velocity.z * step;
    if (position.y <= 0.38) {
      position.y = 0.38;
      velocity.y = Math.abs(velocity.y) * 0.38;
      velocity.x *= 0.72;
      velocity.z *= 0.72;
      if (velocity.y < 1.5) {
        velocity.x = 0;
        velocity.y = 0;
        velocity.z = 0;
      }
    }
  }
  return position;
}

function applyWeaponPickup(socket, player, pickupMap, pickupId, type, ammo) {
  const pickup = pickupMap.get(pickupId);
  const phase = getRoundState().phase;
  const allowedPhase = type === "rifle" ? 2 : 3;
  if (
    !player ||
    !pickup ||
    player.weaponAmmo > 0 ||
    phase !== allowedPhase ||
    roundEndedAt !== null ||
    !isInSafeZone(player) ||
    !isInSafeZone(pickup)
  ) {
    return;
  }
  const distance = Math.hypot(
    player.position.x - pickup.position.x,
    player.position.z - pickup.position.z
  );
  if (distance > 3.5) {
    return;
  }

  pickupMap.delete(pickupId);
  player.weaponType = type;
  player.weaponAmmo = Math.max(1, Math.min(ammo, pickup.ammo || ammo));
  player.knifeEquipped = false;
  socket.emit("weapon:inventory", {
    type: player.weaponType,
    ammo: player.weaponAmmo
  });
  io.emit("weapon:picked", {
    id: pickupId,
    playerId: player.id,
    type,
    ammo: player.weaponAmmo
  });
}

function dropPlayerWeapon(player, forced = false) {
  if (!player || !["rifle", "pistol"].includes(player.weaponType) || player.weaponAmmo < 1) {
    return false;
  }

  const type = player.weaponType;
  const ammo = player.weaponAmmo;
  const pickupMap = type === "rifle" ? rifles : pistols;
  const id = `dropped-${type}-${player.id}-${Date.now()}`;
  const pickup = {
    id,
    position: {
      x: player.position.x,
      y: 0,
      z: player.position.z
    },
    ammo
  };
  pickupMap.set(id, pickup);
  player.weaponType = null;
  player.weaponAmmo = 0;
  player.knifeEquipped = player.hasKnife;
  io.emit("weapon:dropped", {
    ...pickup,
    type,
    playerId: player.id,
    forced
  });
  return true;
}

function enterRoundPhase(phase) {
  if (phase === lastObservedPhase) {
    return;
  }
  lastObservedPhase = phase;
  if (phase < 1) {
    return;
  }

  let eliminatedPlayer = false;
  for (const player of players.values()) {
    if (player.health > 0 && !isInsidePhaseZone(player, player.position, phase)) {
      eliminatedPlayer = eliminatePlayer(player, phase) || eliminatedPlayer;
    }
    if (phase >= 2) {
      player.grenadeCount = 0;
      io.to(player.id).emit("grenade:inventory", { count: 0 });
    }
    const validType =
      (phase === 1 && player.weaponType === "bazooka") ||
      (phase === 2 && player.weaponType === "rifle") ||
      (phase === 3 && player.weaponType === "pistol");
    if (player.weaponType && !validType) {
      if (player.weaponType === "bazooka") {
        player.weaponType = null;
        player.weaponAmmo = 0;
        player.knifeEquipped = player.hasKnife;
      } else {
        dropPlayerWeapon(player, true);
      }
      io.to(player.id).emit("weapon:inventory", { type: null, ammo: 0 });
    }
  }
  if (eliminatedPlayer) {
    finishRound();
  }
}

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  const requestedMode = socket.handshake.query.mode === "ai" ? "ai" : "online";
  if (
    players.size >= 2 ||
    (players.size > 0 && requestedMode !== matchMode)
  ) {
    socket.emit("game:full");
    socket.disconnect(true);
    return;
  }

  if (players.size === 0) {
    matchMode = requestedMode;
  }
  const isNorthSpawn = players.size === 0;
  const player = createPlayer(
    socket.id,
    { x: 0, y: 0, z: isNorthSpawn ? FIELD.minZ + 4 : FIELD.maxZ - 4 },
    isNorthSpawn ? Math.PI : 0
  );

  players.set(socket.id, player);
  if (requestedMode === "ai") {
    const bot = createPlayer(
      "ai-opponent",
      { x: 0, y: 0, z: FIELD.maxZ - 4 },
      0,
      true
    );
    players.set(bot.id, bot);
  }
  if (players.size === 2 && roundStartedAt === null) {
    roundStartedAt = Date.now();
    roundEndedAt = null;
    lastObservedPhase = 0;
    emitRoundState();
  }
  socket.emit("game:state", {
    playerId: socket.id,
    players: Array.from(players.values()),
    grenades: Array.from(grenades.values()),
    rifles: Array.from(rifles.values()),
    pistols: Array.from(pistols.values()),
    knives: Array.from(knives.values()),
    round: getRoundState()
  });
  socket.broadcast.emit("player:joined", player);

  socket.on("player:move", (state) => {
    const { position, yaw, crouching, aiming = false, rolling = false } = state || {};
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(yaw) ||
      typeof crouching !== "boolean" ||
      typeof aiming !== "boolean" ||
      typeof rolling !== "boolean"
    ) {
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer || currentPlayer.health <= 0 || roundEndedAt !== null) {
      return;
    }

    const roundState = getRoundState();
    const acceptedPosition = constrainPlayerToPhase(
      currentPlayer,
      position,
      roundState.phase,
      roundState.escapeOpen
    );
    currentPlayer.position = acceptedPosition;
    currentPlayer.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    currentPlayer.crouching = crouching;
    currentPlayer.aiming = aiming;
    currentPlayer.rolling = rolling;

    if (
      Math.abs(acceptedPosition.x - position.x) > 0.001 ||
      Math.abs(acceptedPosition.y - position.y) > 0.001 ||
      Math.abs(acceptedPosition.z - position.z) > 0.001
    ) {
      socket.emit("player:position", acceptedPosition);
    }

    io.emit("player:moved", {
      id: socket.id,
      position: currentPlayer.position,
      yaw: currentPlayer.yaw,
      crouching: currentPlayer.crouching,
      aiming: currentPlayer.aiming,
      rolling: currentPlayer.rolling
    });
  });

  socket.on("player:shoot", (shot) => {
    const currentPlayer = players.get(socket.id);
    const now = Date.now();
    const direction = shot && shot.direction;
    if (
      !currentPlayer ||
      currentPlayer.health <= 0 ||
      roundEndedAt !== null ||
      !["rifle", "pistol", "bazooka"].includes(currentPlayer.weaponType) ||
      currentPlayer.weaponAmmo < 1 ||
      currentPlayer.knifeEquipped ||
      now - currentPlayer.lastShotAt <
        (currentPlayer.weaponType === "pistol" ? 300 : currentPlayer.weaponType === "bazooka" ? 700 : 110) ||
      !direction ||
      !Number.isFinite(direction.x) ||
      !Number.isFinite(direction.y) ||
      !Number.isFinite(direction.z)
    ) {
      return;
    }

    const magnitude = Math.hypot(direction.x, direction.y, direction.z);
    if (magnitude === 0) {
      return;
    }
    const aimDirection = {
      x: direction.x / magnitude,
      y: direction.y / magnitude,
      z: direction.z / magnitude
    };

    const firedType = currentPlayer.weaponType;
    currentPlayer.lastShotAt = now;
    currentPlayer.weaponAmmo -= 1;
    if (currentPlayer.weaponAmmo === 0) {
      currentPlayer.weaponType = null;
      currentPlayer.knifeEquipped = currentPlayer.hasKnife;
    }
    io.emit("player:shot", {
      id: socket.id,
      position: currentPlayer.position,
      yaw: currentPlayer.yaw,
      crouching: currentPlayer.crouching,
      ammo: currentPlayer.weaponAmmo,
      weaponType: firedType,
      knifeEquipped: currentPlayer.knifeEquipped,
      direction: aimDirection
    });
    socket.emit("weapon:inventory", {
      type: currentPlayer.weaponType,
      ammo: currentPlayer.weaponAmmo
    });

    const target = Array.from(players.values()).find(
      (candidate) => candidate.id !== socket.id && candidate.health > 0
    );
    if (target) {
      const origin = {
        x: currentPlayer.position.x,
        y: currentPlayer.position.y + (currentPlayer.crouching ? 0.82 : 1.25),
        z: currentPlayer.position.z
      };
      const offset = {
        x: target.position.x - origin.x,
        y: target.position.y + 1 - origin.y,
        z: target.position.z - origin.z
      };
      const projection =
        offset.x * aimDirection.x +
        offset.y * aimDirection.y +
        offset.z * aimDirection.z;
      const distanceSquared =
        offset.x ** 2 + offset.y ** 2 + offset.z ** 2 - projection ** 2;
      const hitRadius = firedType === "bazooka" ? 1.8 : 0.85;
      if (projection > 0 && projection < 65 && distanceSquared < hitRadius ** 2) {
        damagePlayer(
          target,
          firedType === "bazooka" ? 100 : firedType === "pistol" ? 28 : 16,
          firedType,
          currentPlayer.id
        );
      }
    }
  });

  socket.on("rifle:pickup", (rifleId) => {
    applyWeaponPickup(
      socket,
      players.get(socket.id),
      rifles,
      rifleId,
      "rifle",
      30
    );
  });

  socket.on("pistol:pickup", (pistolId) => {
    applyWeaponPickup(
      socket,
      players.get(socket.id),
      pistols,
      pistolId,
      "pistol",
      12
    );
  });

  socket.on("knife:pickup", (knifeId) => {
    const currentPlayer = players.get(socket.id);
    const knife = knives.get(knifeId);
    if (
      !currentPlayer ||
      !knife ||
      currentPlayer.hasKnife ||
      getRoundState().phase !== 3 ||
      Math.hypot(knife.position.x, knife.position.z) > CENTER_SAFE_RADIUS ||
      roundEndedAt !== null ||
      !isInSafeZone(currentPlayer) ||
      !isInSafeZone(knife)
    ) {
      return;
    }
    const distance = Math.hypot(
      currentPlayer.position.x - knife.position.x,
      currentPlayer.position.z - knife.position.z
    );
    if (distance > 3.2) {
      return;
    }
    knives.delete(knifeId);
    currentPlayer.hasKnife = true;
    currentPlayer.knifeEquipped = true;
    io.emit("knife:picked", {
      id: knifeId,
      playerId: currentPlayer.id,
      knifeEquipped: true
    });
  });

  socket.on("weapon:select", (selected) => {
    const currentPlayer = players.get(socket.id);
    if (
      !currentPlayer ||
      !currentPlayer.hasKnife ||
      typeof selected?.knifeEquipped !== "boolean" ||
      roundEndedAt !== null
    ) {
      return;
    }
    currentPlayer.knifeEquipped = selected.knifeEquipped;
    io.emit("weapon:selected", {
      id: currentPlayer.id,
      knifeEquipped: currentPlayer.knifeEquipped
    });
  });

  socket.on("knife:attack", () => {
    const attacker = players.get(socket.id);
    const now = Date.now();
    const target = Array.from(players.values()).find(
      (candidate) => candidate.id !== socket.id && candidate.health > 0
    );
    if (
      !attacker ||
      !attacker.hasKnife ||
      !attacker.knifeEquipped ||
      attacker.health <= 0 ||
      roundEndedAt !== null ||
      now - attacker.lastKnifeAt < 700 ||
      !target
    ) {
      return;
    }

    attacker.lastKnifeAt = now;
    const dx = target.position.x - attacker.position.x;
    const dz = target.position.z - attacker.position.z;
    const distance = Math.hypot(dx, dz);
    const forwardX = -Math.sin(attacker.yaw);
    const forwardZ = -Math.cos(attacker.yaw);
    const facing =
      distance > 0 ? (dx * forwardX + dz * forwardZ) / distance : 1;
    if (distance <= 2.4 && facing > 0.25) {
      damagePlayer(target, 45, "knife", attacker.id);
    }
    io.emit("knife:swung", { id: attacker.id });
  });

  socket.on("grenade:pickup", (grenadeId) => {
    const currentPlayer = players.get(socket.id);
    const grenade = grenades.get(grenadeId);
    if (
      !currentPlayer ||
      !grenade ||
      currentPlayer.health <= 0 ||
      currentPlayer.weaponAmmo > 0 ||
      getRoundState().phase !== 1 ||
      roundEndedAt !== null ||
      !isInSafeZone(currentPlayer) ||
      !isInSafeZone(grenade)
    ) {
      return;
    }

    const distance = Math.hypot(
      currentPlayer.position.x - grenade.position.x,
      currentPlayer.position.z - grenade.position.z
    );
    if (distance > 3.2) {
      return;
    }

    grenades.delete(grenadeId);
    currentPlayer.weaponType = "bazooka";
    currentPlayer.weaponAmmo = 1;
    currentPlayer.knifeEquipped = false;
    socket.emit("weapon:inventory", { type: "bazooka", ammo: 1 });
    io.emit("weapon:picked", {
      id: grenadeId,
      playerId: currentPlayer.id,
      type: "bazooka",
      ammo: 1
    });
    io.emit("grenade:picked", { id: grenadeId, playerId: socket.id });
  });

  socket.on("weapon:drop", () => {
    const currentPlayer = players.get(socket.id);
    if (
      !currentPlayer ||
      currentPlayer.health <= 0 ||
      roundEndedAt !== null ||
      currentPlayer.lastWeaponDropAt > Date.now() - 500
    ) {
      return;
    }
    if (dropPlayerWeapon(currentPlayer)) {
      currentPlayer.lastWeaponDropAt = Date.now();
      socket.emit("weapon:inventory", { type: null, ammo: 0 });
    }
  });

  socket.on("grenade:throw", (data) => {
    const currentPlayer = players.get(socket.id);
    const direction = data && data.direction;
    throwGrenade(currentPlayer, direction);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    if (matchMode === "ai") {
      players.delete("ai-opponent");
    }
    io.emit("player:left", { id: socket.id });
    if (players.size === 0) {
      roundStartedAt = null;
      roundEndedAt = null;
      lastObservedPhase = 0;
      matchMode = null;
      for (const [pickupMap, initialItems] of [
        [grenades, initialPickups.grenades],
        [rifles, initialPickups.rifles],
        [pistols, initialPickups.pistols],
        [knives, initialPickups.knives]
      ]) {
        pickupMap.clear();
        initialItems.forEach((item) => pickupMap.set(item.id, item));
      }
      emitRoundState();
    }
  });
});

setInterval(() => {
  if (roundStartedAt === null) {
    return;
  }
  const now = Date.now();
  const state = getRoundState(now);
  enterRoundPhase(state.phase);
  updateAiOpponent(now, 0.25, state);
  if (roundEndedAt !== null) {
    emitRoundState();
    return;
  }
  emitRoundState();
  if (state.remainingMs === 0) {
    finishRound();
  }
}, 250);

httpServer.listen(PORT, () => {
  console.log(`Shooter Stones listo en http://localhost:${PORT}`);
});
