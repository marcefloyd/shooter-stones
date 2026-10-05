import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "three/addons/utils/SkeletonUtils.js";

const canvas = document.querySelector("#game-canvas");
const statusElement = document.querySelector("#connection-status");
const hitFlashElement = document.querySelector("#hit-flash");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1220");
// La cancha mide más de 100 m de punta a punta: sin niebla para que se vea
// completa, incluyendo el rival y los impactos de larga distancia.
scene.fog = null;

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  320
);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

function createCanvasTexture(size, paint) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  paint(context, size);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

const groundColorMap = createCanvasTexture(256, (context, size) => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = Math.random();
      const stripe = ((x + y * 0.35) % 18) < 1.2 ? 18 : 0;
      const r = 38 + n * 28 + stripe;
      const g = 78 + n * 36 + stripe * 0.4;
      const b = 68 + n * 22;
      context.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      context.fillRect(x, y, 1, 1);
    }
  }
});
groundColorMap.colorSpace = THREE.SRGBColorSpace;
groundColorMap.repeat.set(18, 28);

const groundBumpMap = createCanvasTexture(128, (context, size) => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = 90 + Math.random() * 90;
      context.fillStyle = `rgb(${v},${v},${v})`;
      context.fillRect(x, y, 1, 1);
    }
  }
});
groundBumpMap.repeat.set(22, 34);

const rockColorMap = createCanvasTexture(64, (context, size) => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = Math.random();
      const r = 92 + n * 48;
      const g = 96 + n * 42;
      const b = 108 + n * 40;
      context.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      context.fillRect(x, y, 1, 1);
    }
  }
});
rockColorMap.colorSpace = THREE.SRGBColorSpace;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(240, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color("#1a2744") },
      horizonColor: { value: new THREE.Color("#2a4a5e") },
      bottomColor: { value: new THREE.Color("#0a1018") }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.72, h));
        color = mix(bottomColor, color, smoothstep(-0.28, 0.08, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `
  })
);
scene.add(sky);

const starGeometry = new THREE.BufferGeometry();
const starCount = 180;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i += 1) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * 0.9;
  starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * 210;
  starPositions[i * 3 + 1] = 40 + Math.cos(phi) * 160;
  starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * 210;
}
starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
scene.add(
  new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xcfe8ff,
      size: 1.15,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    })
  )
);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(7.5, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xe8f2ff })
);
moon.position.set(-48, 72, -70);
scene.add(moon);
const moonGlow = new THREE.Mesh(
  new THREE.SphereGeometry(11, 16, 12),
  new THREE.MeshBasicMaterial({
    color: 0x9ec4ff,
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  })
);
moonGlow.position.copy(moon.position);
scene.add(moonGlow);

scene.add(new THREE.HemisphereLight(0x7ea4d4, 0x1d2a24, 0.72));
scene.add(new THREE.AmbientLight(0x6f88b0, 0.28));

const sunlight = new THREE.DirectionalLight(0xffd7b0, 1.85);
sunlight.position.set(-18, 28, 16);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -55;
sunlight.shadow.camera.right = 55;
sunlight.shadow.camera.top = 70;
sunlight.shadow.camera.bottom = -70;
sunlight.shadow.camera.near = 2;
sunlight.shadow.camera.far = 90;
sunlight.shadow.bias = -0.00025;
sunlight.shadow.normalBias = 0.04;
scene.add(sunlight);
scene.add(sunlight.target);

const fillLight = new THREE.DirectionalLight(0x6aa8c8, 0.45);
fillLight.position.set(22, 12, -18);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x8ad7c8, 0.28);
rimLight.position.set(0, 10, 24);
scene.add(rimLight);

const fieldWidth = 68;
const fieldLength = 105;
const field = new THREE.Mesh(
  new THREE.PlaneGeometry(fieldWidth, fieldLength, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x4d7a70,
    map: groundColorMap,
    bumpMap: groundBumpMap,
    bumpScale: 0.18,
    roughness: 0.92,
    metalness: 0.04
  })
);
field.rotation.x = -Math.PI / 2;
field.receiveShadow = true;
scene.add(field);

const markingMaterial = new THREE.LineBasicMaterial({
  color: 0xeaf6d8,
  transparent: true,
  opacity: 0.82
});
const halfWidth = fieldWidth / 2;
const halfLength = fieldLength / 2;

const zoneLength = fieldLength / 6;
const zoneWarningOverlays = [];
for (let zone = 0; zone < 6; zone += 1) {
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldWidth, zoneLength),
    new THREE.MeshStandardMaterial({
      color: zone % 2 === 0 ? 0x5a8a7c : 0x4d7a72,
      map: groundColorMap,
      bumpMap: groundBumpMap,
      bumpScale: 0.14,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: 0.42
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(0, 0.012, -halfLength + zoneLength * (zone + 0.5));
  surface.receiveShadow = true;
  scene.add(surface);

  const warningOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldWidth, zoneLength),
    new THREE.MeshBasicMaterial({
      color: 0xff182d,
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  );
  warningOverlay.rotation.x = -Math.PI / 2;
  warningOverlay.position.set(0, 0.045, -halfLength + zoneLength * (zone + 0.5));
  warningOverlay.renderOrder = 2;
  scene.add(warningOverlay);
  zoneWarningOverlays.push(warningOverlay);
}

const grenadeSpawnPoints = [];
const grenadePickups = new Map();
const riflePickups = new Map();
const pistolPickups = new Map();
const knifePickups = new Map();
for (const zoneIndex of [0, 5]) {
  const zoneCenterZ = -halfLength + zoneLength * (zoneIndex + 0.5);
  [-8, 0, 8].forEach((zOffset, row) => {
    [-22, 0, 22].forEach((x, column) => {
      grenadeSpawnPoints.push({
        id: `grenade-${zoneIndex}-${row}-${column}`,
        position: { x, y: 0, z: zoneCenterZ + zOffset }
      });
    });
  });
}
const rifleSpawnPoints = [];
for (const zoneIndex of [1, 4]) {
  const zoneCenterZ = -halfLength + zoneLength * (zoneIndex + 0.5);
  [-18, 0, 18].forEach((x, slot) => {
    rifleSpawnPoints.push({
      id: `rifle-${zoneIndex}-${slot}`,
      position: { x, y: 0, z: zoneCenterZ + (slot - 1) * 3 }
    });
  });
}
const pistolSpawnPoints = [];
for (const zoneIndex of [2, 3]) {
  const zoneCenterZ = zoneIndex === 2 ? -14 : 14;
  [-20, -10, 0, 10, 20].forEach((x, slot) => {
    pistolSpawnPoints.push({
      id: `pistol-${zoneIndex}-${slot}`,
      position: { x, y: 0, z: zoneCenterZ }
    });
  });
}
const knifeSpawnPoints = [-3.8, 3.8].map((z, slot) => ({
  id: `knife-${slot}`,
  position: { x: 0, y: 0, z }
}));
const protectedSpawnPoints = [
  ...grenadeSpawnPoints,
  ...rifleSpawnPoints,
  ...pistolSpawnPoints,
  ...knifeSpawnPoints
];

function addMarking(points) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, z]) => new THREE.Vector3(x, 0.035, z))
  );
  scene.add(new THREE.Line(geometry, markingMaterial));
}

addMarking([
  [-halfWidth, -halfLength],
  [halfWidth, -halfLength],
  [halfWidth, halfLength],
  [-halfWidth, halfLength],
  [-halfWidth, -halfLength]
]);
addMarking([
  [-halfWidth, 0],
  [halfWidth, 0]
]);
for (let zone = 1; zone < 6; zone += 1) {
  const z = -halfLength + zoneLength * zone;
  addMarking([
    [-halfWidth, z],
    [halfWidth, z]
  ]);
}

const centerCircle = [];
for (let i = 0; i <= 48; i += 1) {
  const angle = (i / 48) * Math.PI * 2;
  centerCircle.push([Math.cos(angle) * 9.15, Math.sin(angle) * 9.15]);
}
addMarking(centerCircle);

const centerDisc = new THREE.Mesh(
  new THREE.CircleGeometry(9.15, 48),
  new THREE.MeshStandardMaterial({
    color: 0x6ea894,
    emissive: 0x14352c,
    emissiveIntensity: 0.18,
    roughness: 0.86,
    transparent: true,
    opacity: 0.35
  })
);
centerDisc.rotation.x = -Math.PI / 2;
centerDisc.position.y = 0.02;
centerDisc.receiveShadow = true;
scene.add(centerDisc);

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0xd9dee5,
  roughness: 0.82,
  metalness: 0.03,
  flatShading: true
});
function addPerimeterWall(width, height, depth, x, z) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
  wall.position.set(x, height / 2 - 0.2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}
addPerimeterWall(fieldWidth + 10, 9, 4.2, 0, -halfLength - 2.2);
addPerimeterWall(fieldWidth + 10, 9, 4.2, 0, halfLength + 2.2);
addPerimeterWall(4.2, 9, fieldLength + 10, -halfWidth - 2.2, 0);
addPerimeterWall(4.2, 9, fieldLength + 10, halfWidth + 2.2, 0);

const floodPositions = [
  [-halfWidth - 1.2, 8.4, -halfLength - 1.2],
  [halfWidth + 1.2, 8.4, -halfLength - 1.2],
  [-halfWidth - 1.2, 8.4, halfLength + 1.2],
  [halfWidth + 1.2, 8.4, halfLength + 1.2]
];
floodPositions.forEach(([x, y, z]) => {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.22, 8.2, 6),
    wallMaterial
  );
  pole.position.set(x, 4.1, z);
  pole.castShadow = true;
  scene.add(pole);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe4b5 })
  );
  lamp.position.set(x, y, z);
  scene.add(lamp);
  const flood = new THREE.PointLight(0xffd9a8, 2.4, 48, 2);
  flood.position.set(x, y, z);
  scene.add(flood);
});

const arenaRng = createArenaRandom(5831);
const rockGeometry = new THREE.BoxGeometry(2.8, 1.7, 0.75);
const rockMaterial = new THREE.MeshStandardMaterial({
  color: 0x77736c,
  map: rockColorMap,
  roughness: 0.88,
  metalness: 0.08,
  flatShading: true
});
const rockObstacles = [];
const movingRocks = [];
const teleportingRocks = [];

function createArenaRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function addArenaRocks(count) {
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, count);
  const transform = new THREE.Object3D();

  for (let i = 0; i < count; i += 1) {
    let x;
    let z;
    let attempts = 0;
    do {
      x = arenaRng() * (fieldWidth - 6) - (fieldWidth - 6) / 2;
      z = arenaRng() * (fieldLength - 6) - (fieldLength - 6) / 2;
      attempts += 1;
    } while (
      attempts < 50 &&
      (Math.hypot(x + 3, z) < 4 ||
        Math.hypot(x - 3, z) < 4 ||
        ((Math.floor((z + halfLength) / zoneLength) === 2 ||
          Math.floor((z + halfLength) / zoneLength) === 3) &&
          Math.hypot(x, z) < 12.5) ||
        protectedSpawnPoints.some(
          (spawn) =>
            Math.hypot(x - spawn.position.x, z - spawn.position.z) < 2.8
        ))
    );

    const scale = 0.65 + arenaRng() * 0.8;
    const scaleX = scale * (0.8 + arenaRng() * 0.5);
    const scaleZ = scale * (0.8 + arenaRng() * 0.5);
    const rotationX = arenaRng() * 0.35;
    const rotationY = arenaRng() * Math.PI;
    const rotationZ = arenaRng() * 0.35;
    const radius = Math.hypot(1.4 * scaleX, 0.375 * scaleZ) +
      0.85 * scale * Math.SQRT2 * Math.sin(0.35);
    transform.position.set(x, 0.85 * scale, z);
    transform.rotation.set(rotationX, rotationY, rotationZ);
    transform.scale.set(
      scaleX,
      scale,
      scaleZ
    );
    transform.updateMatrix();
    rocks.setMatrixAt(i, transform.matrix);

    const zoneIndex = Math.min(
      5,
      Math.floor((z + halfLength) / zoneLength)
    );
    const rock = {
      index: i,
      x,
      z,
      y: 0.85 * scale,
      radius,
      scaleX,
      scaleY: scale,
      scaleZ,
      rotationX,
      rotationZ,
      rotationY,
      colliderHalfExtents: {
        x: 1.4 * scaleX,
        y: 0.85 * scale,
        z: 0.375 * scaleZ
      },
      minZ: -halfLength + zoneLength * zoneIndex + radius,
      maxZ: -halfLength + zoneLength * (zoneIndex + 1) - radius,
      minX: -halfWidth + radius,
      maxX: halfWidth - radius
    };
    rockObstacles.push(rock);
    if (zoneIndex === 1 || zoneIndex === 4) {
      const angle = arenaRng() * Math.PI * 2;
      const speed = 0.45 + arenaRng() * 0.45;
      rock.velocityX = Math.cos(angle) * speed;
      rock.velocityZ = Math.sin(angle) * speed;
      movingRocks.push(rock);
    }
    if (zoneIndex === 2 || zoneIndex === 3) {
      teleportingRocks.push(rock);
    }
  }

  rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Esta malla detallada se repite 72 veces; evita renderizarla también en el mapa de sombras.
  rocks.castShadow = false;
  rocks.receiveShadow = false;
  scene.add(rocks);
  return rocks;
}

function loadArenaRockModel(instancedRocks) {
  const loader = new GLTFLoader();
  loader.load("/assets/modelos/muro_vikingo.glb", (gltf) => {
    let sourceMesh = null;
    gltf.scene.traverse((node) => {
      if (!sourceMesh && node.isMesh) sourceMesh = node;
    });
    if (!sourceMesh) {
      console.error("El modelo del muro no contiene una malla.");
      return;
    }

    gltf.scene.updateMatrixWorld(true);
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0 || size.y <= 0 || size.z <= 0) {
      geometry.dispose();
      console.error("No se pudieron calcular los límites del modelo de piedra.");
      return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(2.8 / size.x, 1.7 / size.y, 0.75 / size.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const positions = geometry.getAttribute("position");
    let horizontalRadius = 0;
    let maximumVerticalExtent = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      horizontalRadius = Math.max(horizontalRadius, Math.hypot(x, z));
      maximumVerticalExtent = Math.max(maximumVerticalExtent, Math.abs(y));
    }
    // Incluye la extensión lateral que aparece al inclinar la roca.
    const normalizedSize = geometry.boundingBox.getSize(new THREE.Vector3());
    rockObstacles.forEach((rock) => {
      rock.colliderHalfExtents = {
        x: normalizedSize.x * rock.scaleX / 2,
        y: normalizedSize.y * rock.scaleY / 2,
        z: normalizedSize.z * rock.scaleZ / 2
      };
      rock.radius = Math.hypot(
        rock.colliderHalfExtents.x,
        rock.colliderHalfExtents.z
      ) + rock.colliderHalfExtents.y * Math.SQRT2 * Math.sin(0.35);
    });

    const previousGeometry = instancedRocks.geometry;
    instancedRocks.geometry = geometry;
    instancedRocks.material = sourceMesh.material.clone();
    previousGeometry.dispose();
  }, undefined, (error) => {
    console.error("No se pudo cargar el muro vikingo:", error);
  });
}

const propMaterials = {
  grenade: new THREE.MeshStandardMaterial({
    color: 0x91b96d,
    roughness: 0.55,
    metalness: 0.22,
    emissive: 0x1a3310,
    emissiveIntensity: 0.18,
    flatShading: true
  }),
  grenadeDark: new THREE.MeshStandardMaterial({
    color: 0x53634c,
    roughness: 0.48,
    metalness: 0.28
  }),
  rifle: new THREE.MeshStandardMaterial({
    color: 0x2c3144,
    roughness: 0.38,
    metalness: 0.55,
    flatShading: true
  }),
  rifleAccent: new THREE.MeshStandardMaterial({
    color: 0xd49a5c,
    roughness: 0.52,
    metalness: 0.18,
    emissive: 0x3a220c,
    emissiveIntensity: 0.12
  }),
  knife: new THREE.MeshStandardMaterial({
    color: 0xd8e6e2,
    metalness: 0.82,
    roughness: 0.18,
    flatShading: true
  }),
  knifeHandle: new THREE.MeshStandardMaterial({
    color: 0xd47a64,
    roughness: 0.7,
    metalness: 0.08
  })
};
const sharedPropMaterials = new Set(Object.values(propMaterials));
const pickupBeaconGeometry = {
  ring: new THREE.TorusGeometry(0.72, 0.035, 5, 24),
  beam: new THREE.CylinderGeometry(0.035, 0.2, 0.85, 8, 1, true)
};
const pickupBeaconMaterials = {
  grenade: new THREE.MeshBasicMaterial({
    color: 0xa9ec75,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: false
  }),
  rifle: new THREE.MeshBasicMaterial({
    color: 0x77dfff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: false
  }),
  pistol: new THREE.MeshBasicMaterial({
    color: 0xffd078,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: false
  }),
  knife: new THREE.MeshBasicMaterial({
    color: 0xf0f5ff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    depthTest: false
  })
};
const pickupLabelTextures = new Map();

function createPickupLabelTexture(type) {
  if (pickupLabelTextures.has(type)) {
    return pickupLabelTextures.get(type);
  }
  const labels = {
    grenade: "BAZOOKA",
    rifle: "RIFLE",
    pistol: "PISTOLA",
    knife: "MACHETE"
  };
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear la etiqueta visual de los objetos.");
  }
  context.fillStyle = "rgba(12, 20, 30, 0.88)";
  context.beginPath();
  context.roundRect(3, 3, 250, 58, 12);
  context.fill();
  context.strokeStyle = `#${pickupBeaconMaterials[type].color.getHexString()}`;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = "#f3fff9";
  context.font = "bold 28px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(labels[type], 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  pickupLabelTextures.set(type, texture);
  return texture;
}

function addPickupBeacon(pickup, type) {
  const material = pickupBeaconMaterials[type];
  const ring = new THREE.Mesh(pickupBeaconGeometry.ring, material);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.045;
  pickup.add(ring);

  const beam = new THREE.Mesh(pickupBeaconGeometry.beam, material);
  beam.position.y = 1.05;
  beam.scale.y = 2.25;
  pickup.add(beam);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createPickupLabelTexture(type),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
  );
  label.position.y = 2.35;
  label.scale.set(2.35, 0.59, 1);
  pickup.add(label);
  pickup.userData.pickupBeacon = { ring, beam, label, type };
}

function updatePickupBeacons(now) {
  const pickups = [
    ...grenadePickups.values(),
    ...riflePickups.values(),
    ...pistolPickups.values(),
    ...knifePickups.values()
  ];
  pickups.forEach((pickup) => {
    const beacon = pickup.userData.pickupBeacon;
    if (!beacon) {
      return;
    }
    const phase = roundPhase;
    const active =
      (phase === 1 && beacon.type === "grenade") ||
      (phase === 2 && beacon.type === "rifle") ||
      (phase === 3 &&
        (beacon.type === "pistol" || beacon.type === "knife"));
    beacon.ring.visible = active;
    beacon.beam.visible = active;
    beacon.label.visible = active;
    const pulse = 1 + Math.sin(now * 0.003 + pickup.position.x) * 0.08;
    beacon.ring.scale.setScalar(pulse);
    beacon.beam.material.opacity = 0.4 + (pulse - 0.92) * 1.4;
    beacon.label.material.opacity = 0.92;
  });
}

function addPropPart(group, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) {
    mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

const propGltfLoader = new GLTFLoader();
const propGltfTemplates = new Map();
const propGltfUrls = {
  ak47: "/assets/set3descomprimido/ak47/scene.gltf",
  grenade: "/assets/set3descomprimido/granada/scene.gltf",
  bazooka: "/assets/set3descomprimido/bazooka/scene.gltf",
  machete: "/assets/set3descomprimido/barcode_machete/scene.gltf",
  pistol: "/assets/set3descomprimido/pistola/scene.gltf",
  pistol9mm: "/assets/set3descomprimido/pistola_9mm/scene.gltf",
  m4: "/assets/set3descomprimido/classic_m4/scene.gltf"
};

function addGltfProp(group, fallback, type) {
  fallback.visible = false;
  if (!propGltfTemplates.has(type)) {
    const url = propGltfUrls[type];
    const request = new Promise((resolve, reject) => {
      propGltfLoader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    });
    propGltfTemplates.set(type, request);
  }

  propGltfTemplates.get(type).then((template) => {
    if (!group.parent && !scene.children.includes(group)) {
      return;
    }
    const model = template.clone(true);
    model.traverse((node) => {
      if (node.isMesh) {
        node.geometry = node.geometry.clone();
        node.material = Array.isArray(node.material)
          ? node.material.map((material) => material.clone())
          : node.material.clone();
      }
    });

    const isPistolModel = type === "pistol" || type === "pistol9mm";
    if (type === "grenade") {
      model.rotation.x = -Math.PI / 2;
    } else if (type === "machete") {
      // El modelo tiene la hoja sobre su eje +Z; apunta hacia delante (-Z).
      model.rotation.y = Math.PI;
    } else if (type === "m4") {
      // La M4 tiene el cañón sobre +Z en el archivo descargado.
      model.rotation.y = Math.PI;
    }

    let bounds = new THREE.Box3().setFromObject(model);
    let size = bounds.getSize(new THREE.Vector3());
    if ((type === "ak47" || isPistolModel) && size.x > size.z) {
      model.rotation.y = Math.PI / 2;
      bounds = new THREE.Box3().setFromObject(model);
      size = bounds.getSize(new THREE.Vector3());
    }

    const targetSize = type === "ak47" || type === "m4" || type === "bazooka"
      ? 2.2
      : isPistolModel
        ? 0.82
        : type === "machete"
          ? 1.08
          : 0.76;
    const measuredSize = type === "ak47" || type === "m4" || type === "bazooka" || type === "machete" || isPistolModel
      ? Math.max(size.x, size.y, size.z)
      : size.y;
    const scale = targetSize / (measuredSize || 1);
    model.scale.setScalar(scale);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    model.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    fallback.visible = false;
    group.add(model);
  }).catch((error) => {
    fallback.visible = true;
    console.error(`No se pudo cargar el modelo ${type} (${propGltfUrls[type]}):`, error);
  });
}

function createGrenade() {
  const grenade = new THREE.Group();
  const fallback = new THREE.Group();
  grenade.add(fallback);
  addPropPart(
    fallback,
    new THREE.IcosahedronGeometry(0.38, 1),
    propMaterials.grenade,
    [0, 0.38, 0]
  );
  addPropPart(
    fallback,
    new THREE.CylinderGeometry(0.14, 0.18, 0.2, 6),
    propMaterials.grenadeDark,
    [0, 0.7, 0]
  );
  addPropPart(
    fallback,
    new THREE.TorusGeometry(0.2, 0.035, 4, 8),
    propMaterials.rifleAccent,
    [0.18, 0.72, 0],
    [Math.PI / 2, 0, 0]
  );
  addGltfProp(grenade, fallback, "grenade");
  return grenade;
}

function rifleVariantForPickup(id) {
  const spawn = /^rifle-(\d+)-(\d+)$/.exec(String(id));
  if (spawn) {
    return (Number(spawn[1]) + Number(spawn[2])) % 2;
  }
  let hash = 0;
  for (const character of String(id || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 2;
}

function createGroundRifle(position, pickupId) {
  const rifle = createRifle(rifleVariantForPickup(pickupId));
  rifle.position.set(position.x, 0.08, position.z);
  rifle.userData.pickupId = pickupId || null;
  addPickupBeacon(rifle, "rifle");
  return rifle;
}

function pistolVariantForPickup(id) {
  const spawn = /^pistol-\d+-(\d+)$/.exec(String(id));
  if (spawn) {
    // El modelo más pesado aparece solo una vez por franja central.
    return Number(spawn[1]) === 2 ? 0 : 1;
  }
  let hash = 0;
  for (const character of String(id || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 2;
}

function createGroundPistol(position, pickupId) {
  const pistol = createPistol(pistolVariantForPickup(pickupId));
  pistol.position.set(position.x, 0.05, position.z);
  pistol.userData.pickupId = pickupId || null;
  addPickupBeacon(pistol, "pistol");
  return pistol;
}

function createGroundKnife(position) {
  const knife = createKnife();
  knife.position.set(position.x, 0, position.z);
  knife.rotation.y = arenaRng() * Math.PI * 2;
  knife.userData.pickupId = null;
  addPickupBeacon(knife, "knife");
  return knife;
}

function createRifle(variant = 0) {
  const rifle = new THREE.Group();
  const fallback = new THREE.Group();
  rifle.add(fallback);
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.34, 0.2, 1.45),
    propMaterials.rifle,
    [0, 0.2, 0]
  );
  addPropPart(
    fallback,
    new THREE.CylinderGeometry(0.055, 0.055, 0.95, 6),
    propMaterials.rifle,
    [0, 0.22, -1.05],
    [Math.PI / 2, 0, 0]
  );
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.19, 0.36, 0.28),
    propMaterials.rifleAccent,
    [0, 0.08, 0.32]
  );
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.16, 0.35, 0.25),
    propMaterials.rifle,
    [0, -0.04, -0.05]
  );
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.16, 0.12, 0.28),
    propMaterials.rifleAccent,
    [0, 0.34, -0.14]
  );
  addGltfProp(rifle, fallback, variant === 0 ? "ak47" : "m4");
  return rifle;
}

function createPistol(variant = 1) {
  const pistol = new THREE.Group();
  const fallback = new THREE.Group();
  pistol.add(fallback);
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.26, 0.18, 0.62),
    propMaterials.rifle,
    [0, 0.19, -0.04]
  );
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.2, 0.32, 0.2),
    propMaterials.rifleAccent,
    [0, 0.02, 0.16],
    [-0.18, 0, 0]
  );
  addPropPart(
    fallback,
    new THREE.CylinderGeometry(0.045, 0.045, 0.38, 6),
    propMaterials.rifle,
    [0, 0.21, -0.48],
    [Math.PI / 2, 0, 0]
  );
  addGltfProp(pistol, fallback, variant === 0 ? "pistol" : "pistol9mm");
  return pistol;
}

function setHeldWeaponVariant(player, type, variant) {
  const isRifle = type === "rifle";
  const key = isRifle ? "heldRifle" : "heldPistol";
  const variantKey = isRifle ? "rifleVariant" : "pistolVariant";
  if (!player || player.userData[variantKey] === variant) {
    return;
  }

  const previous = player.userData[key];
  if (!previous) {
    player.userData[variantKey] = variant;
    return;
  }

  const replacement = isRifle ? createRifle(variant) : createPistol(variant);
  replacement.position.copy(previous.position);
  replacement.quaternion.copy(previous.quaternion);
  replacement.scale.copy(previous.scale);
  replacement.visible = previous.visible;
  replacement.userData.weaponVariant = variant;

  const parent = previous.parent || player.userData.characterVisual;
  parent?.add(replacement);
  parent?.remove(previous);
  player.userData[key] = replacement;
  player.userData[variantKey] = variant;

  const playerId = player.userData.playerId;
  if (isRifle) {
    playerRifleVariants.set(playerId, variant);
  } else {
    playerPistolVariants.set(playerId, variant);
  }

  previous.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material && !sharedPropMaterials.has(material)) material.dispose();
    });
  });
}

const knifeBladeShape = new THREE.Shape();
knifeBladeShape.moveTo(-0.12, 0);
knifeBladeShape.lineTo(0.12, 0);
knifeBladeShape.lineTo(0.1, 0.62);
knifeBladeShape.lineTo(0, 0.9);
knifeBladeShape.lineTo(-0.1, 0.62);
knifeBladeShape.closePath();
const knifeBladeGeometry = new THREE.ExtrudeGeometry(knifeBladeShape, {
  depth: 0.045,
  bevelEnabled: false
});

function createKnife() {
  const knife = new THREE.Group();
  const fallback = new THREE.Group();
  knife.add(fallback);
  addPropPart(
    fallback,
    new THREE.BoxGeometry(0.24, 0.15, 0.4),
    propMaterials.knifeHandle,
    [0, 0.14, 0.18]
  );
  addPropPart(
    fallback,
    knifeBladeGeometry,
    propMaterials.knife,
    [0, 0.14, -0.02],
    [-Math.PI / 2, 0, 0]
  );
  addGltfProp(knife, fallback, "machete");
  return knife;
}

function createGroundGrenade(position) {
  const bazooka = createBazooka();
  bazooka.position.set(position.x, 0.05, position.z);
  bazooka.rotation.y = arenaRng() * Math.PI * 2;
  bazooka.userData.pickupId = null;
  addPickupBeacon(bazooka, "grenade");
  return bazooka;
}

function createBazooka() {
  const bazooka = new THREE.Group();
  const fallback = new THREE.Group();
  bazooka.add(fallback);
  addPropPart(fallback, new THREE.CylinderGeometry(0.15, 0.15, 1.7, 8), propMaterials.rifle, [0, 0.25, 0], [Math.PI / 2, 0, 0]);
  addGltfProp(bazooka, fallback, "bazooka");
  return bazooka;
}

function addArenaEquipment() {
  grenadeSpawnPoints.forEach((spawn) => {
    const grenade = createGroundGrenade(spawn.position);
    grenade.userData.pickupId = spawn.id;
    scene.add(grenade);
    grenadePickups.set(spawn.id, grenade);
  });
  rifleSpawnPoints.forEach((spawn) => {
    const rifle = createGroundRifle(spawn.position, spawn.id);
    rifle.userData.pickupId = spawn.id;
    scene.add(rifle);
    riflePickups.set(spawn.id, rifle);
  });
  pistolSpawnPoints.forEach((spawn) => {
    const pistol = createGroundPistol(spawn.position, spawn.id);
    pistol.userData.pickupId = spawn.id;
    scene.add(pistol);
    pistolPickups.set(spawn.id, pistol);
  });
  knifeSpawnPoints.forEach((spawn) => {
    const knife = createGroundKnife(spawn.position);
    knife.userData.pickupId = spawn.id;
    scene.add(knife);
    knifePickups.set(spawn.id, knife);
  });
}

const arenaRocks = addArenaRocks(72);
loadArenaRockModel(arenaRocks);
addArenaEquipment();

let socket = null;
const keys = new Set();
const players = new Map();
const playerRifleVariants = new Map();
const playerPistolVariants = new Map();
const playerTargets = new Map();
const projectiles = [];
const thrownGrenades = new Map();
const grenadeExplosions = [];
const fxParticles = [];
const fxLights = [];
const muzzleFlashes = [];
const projectileGeometry = new THREE.CylinderGeometry(0.035, 0.018, 0.85, 6);
projectileGeometry.rotateX(Math.PI / 2);
const projectileMaterial = new THREE.MeshBasicMaterial({
  color: 0xffe18a,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const bazookaProjectileBodyGeometry = new THREE.CylinderGeometry(0.11, 0.11, 0.92, 8);
bazookaProjectileBodyGeometry.rotateX(Math.PI / 2);
const bazookaProjectileTipGeometry = new THREE.ConeGeometry(0.17, 0.34, 8);
bazookaProjectileTipGeometry.rotateX(Math.PI / 2);
// Keep the projectile materials unlit: they are small and short lived, and
// compiling additional lit materials during the first shot can stall rendering.
const bazookaProjectileBodyMaterial = new THREE.MeshBasicMaterial({
  color: 0x536d45
});
const bazookaProjectileTipMaterial = new THREE.MeshBasicMaterial({
  color: 0x8df542
});
const sparkGeometry = new THREE.SphereGeometry(0.05, 5, 4);
const smokeGeometry = new THREE.SphereGeometry(0.22, 7, 6);
const debrisGeometry = new THREE.DodecahedronGeometry(0.08, 0);
const dustGeometry = new THREE.SphereGeometry(0.07, 5, 4);
const fxMaterials = {
  spark: new THREE.MeshBasicMaterial({
    color: 0xffc978,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }),
  fire: new THREE.MeshBasicMaterial({
    color: 0xff7a32,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }),
  smoke: new THREE.MeshBasicMaterial({
    color: 0x6b737c,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  }),
  dust: new THREE.MeshBasicMaterial({
    color: 0xb7c4a8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  }),
  debris: new THREE.MeshStandardMaterial({
    color: 0x6a6f78,
    roughness: 0.9,
    flatShading: true
  })
};
const raycaster = new THREE.Raycaster();
const projectileColliderEuler = new THREE.Euler();
const projectileColliderInverseRotation = new THREE.Quaternion();
const projectileColliderCenter = new THREE.Vector3();
const projectileColliderOrigin = new THREE.Vector3();
const projectileColliderDirection = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const localRight = new THREE.Vector3(1, 0, 0);
const moveSpeed = 6.5;
const sprintSpeed = 10.5;
const crouchSpeed = 2.6;
const gravity = 22;
const jumpSpeed = 8.5;
const automaticFireInterval = 110;
const grenadePickupRange = 2.8;
const riflePickupRange = 3.5;
const pistolPickupRange = 3.5;
const knifePickupRange = 3.2;
const grenadePickupPrompt = document.querySelector("#pickup-prompt");
const grenadeCountElement = document.querySelector("#grenade-count");
const weaponAmmoElement = document.querySelector("#weapon-ammo");
const weaponCapacityElement = document.querySelector("#weapon-capacity");
const weaponStatusElement = document.querySelector("#weapon-status");
const soundToggle = document.querySelector("#sound-toggle");
const healthValueElement = document.querySelector("#health-value");
const healthBarElement = document.querySelector(".health-bar");
const roundStatusElement = document.querySelector("#round-status");
const roundResultElement = document.querySelector("#round-result");
const roundResultTextElement = document.querySelector("#round-result-text");
const endMenuActionsElement = document.querySelector("#end-menu-actions");
const restartMatchButton = document.querySelector("#restart-match-button");
const returnMenuButton = document.querySelector("#return-menu-button");
const bloodParticles = [];
const bloodParticleGeometry = new THREE.SphereGeometry(0.065, 5, 4);
const bloodParticleMaterial = new THREE.MeshBasicMaterial({
  color: 0xa91f35,
  transparent: true,
  opacity: 0.92
});
const startingZoneRadius = Math.hypot(halfWidth, halfLength);
const centerSafeRadius = 9.15;
const fieldBounds = {
  minX: -33.5,
  maxX: 33.5,
  minZ: -52.5,
  maxZ: 52.5
};

let localPlayerId = null;
let localPlayer = null;
let lastRockSyncAt = 0;
let localPhaseSide = 1;
let isAiming = false;
let isDraggingView = false;
let isFiring = false;
let cameraYaw = 0;
let cameraPitch = -0.12;
let verticalVelocity = 0;
const rollDuration = 620;
const rollDistance = 4.2;
let lastShotAt = -Infinity;
let grenadeCount = 0;
let weaponType = null;
let weaponAmmo = 0;
let hasKnife = false;
let knifeEquipped = false;
let roundStartedAt = null;
let seriesState = { enabled: false, roundNumber: 1, maxRounds: 3, scores: {} };
let safeRadius = startingZoneRadius;
let roundPhase = 0;
let phaseRemainingMs = 0;
let phaseStateReceivedAt = 0;
let escapeOpen = false;
let lastWarningSoundAt = -Infinity;
let playerHealth = 100;
let roundEnded = false;
let lastTeleportStep = -1;
let teleportRng = createArenaRandom(9417);
let lastGrenadeThrowAt = 0;
let lastMoveSentAt = 0;
let lastSentState = null;
let audioContext = null;
let masterVolume = null;
let noiseBuffer = null;
const sampleSounds = new Map();
let audioMuted = false;
let footstepCooldown = 0;
let cameraShake = 0;
let hitFlashUntil = 0;

function initializeAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    soundToggle.disabled = true;
    soundToggle.textContent = "AUDIO NO DISPONIBLE";
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
    masterVolume = audioContext.createGain();
    masterVolume.gain.value = 0.42;
    masterVolume.connect(audioContext.destination);
    noiseBuffer = audioContext.createBuffer(
      1,
      audioContext.sampleRate,
      audioContext.sampleRate
    );
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.random() * 2 - 1;
    }
    loadSampleSounds();
  }
  audioContext.resume().catch(() => {
    statusElement.textContent = "El audio no pudo iniciarse en este navegador.";
  });
}

async function loadSampleSounds() {
  const sounds = {
    weaponFire: "/assets/sounds/weapon-fire.ogg",
    weaponDry: "/assets/sounds/weapon-dry.ogg",
    weaponEquip: "/assets/sounds/weapon-equip.ogg"
  };
  await Promise.all(Object.entries(sounds).map(async ([name, url]) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.arrayBuffer();
      sampleSounds.set(name, await audioContext.decodeAudioData(data));
    } catch (error) {
      console.warn(`No se pudo cargar el sonido ${name}:`, error);
    }
  }));
}

function playSampleSound(name, position = null, volume = 0.8) {
  const buffer = sampleSounds.get(name);
  if (!audioContext || audioMuted || !buffer) {
    return false;
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  connectSoundNode(source, volume, position);
  source.start();
  return true;
}

function connectSoundNode(node, volume, position) {
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  if (position && localPlayer) {
    const offsetX = position.x - localPlayer.position.x;
    const offsetZ = position.z - localPlayer.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    const pan = THREE.MathUtils.clamp(
      (offsetX * Math.cos(cameraYaw) - offsetZ * Math.sin(cameraYaw)) /
        Math.max(distance, 0.001),
      -1,
      1
    );
    gain.gain.setValueAtTime(volume / (1 + distance * 0.018), audioContext.currentTime);
    const stereo = audioContext.createStereoPanner();
    stereo.pan.setValueAtTime(pan, audioContext.currentTime);
    node.connect(gain);
    gain.connect(stereo);
    stereo.connect(masterVolume);
    return gain;
  }
  node.connect(gain);
  gain.connect(masterVolume);
  return gain;
}

function playTone(
  frequency,
  endFrequency,
  duration,
  volume,
  type = "sine",
  position = null
) {
  if (!audioContext || audioMuted) {
    return;
  }
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, endFrequency),
    now + duration
  );
  const gain = connectSoundNode(oscillator, volume, position);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playNoise(duration, volume, filterType, frequency, position = null) {
  if (!audioContext || audioMuted || !noiseBuffer) {
    return;
  }
  const now = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = connectSoundNode(filter, volume, position);
  source.buffer = noiseBuffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  source.connect(filter);
  source.start(now, Math.random() * Math.max(0, 1 - duration), duration);
  source.stop(now + duration);
}

function playShotSound(weaponType, position) {
  if (playSampleSound("weaponFire", position, weaponType === "pistol" ? 0.74 : 0.68)) {
    return;
  }
  if (weaponType === "pistol") {
    playNoise(0.18, 0.48, "bandpass", 1450, position);
    playTone(170, 48, 0.2, 0.55, "sawtooth", position);
    playTone(1850, 420, 0.06, 0.2, "triangle", position);
    return;
  }
  playNoise(0.09, 0.42, "highpass", 1750, position);
  playNoise(0.23, 0.42, "lowpass", 420, position);
  playTone(125, 34, 0.24, 0.48, "sine", position);
  playTone(2100, 520, 0.09, 0.18, "triangle", position);
}

function playDryFireSound() {
  if (!playSampleSound("weaponDry", null, 0.65)) {
    playNoise(0.055, 0.12, "bandpass", 900);
    playTone(260, 190, 0.07, 0.08, "triangle");
  }
}

function playWeaponEquipSound() {
  if (!playSampleSound("weaponEquip", null, 0.58)) {
    playPickupSound();
  }
}

function playKnifeSound() {
  playNoise(0.17, 0.16, "bandpass", 1250);
  playTone(420, 110, 0.12, 0.08, "triangle");
}

function playGrenadeThrowSound() {
  playNoise(0.11, 0.12, "lowpass", 700);
  playTone(180, 90, 0.12, 0.1, "triangle");
}

function playExplosionSound(position = null) {
  playNoise(0.82, 0.75, "lowpass", 180, position);
  playNoise(0.2, 0.42, "highpass", 1150, position);
  playTone(82, 27, 0.78, 0.76, "sine", position);
  playTone(58, 32, 0.58, 0.35, "triangle", position);
  window.setTimeout(
    () => playNoise(0.48, 0.22, "bandpass", 520, position),
    100
  );
}

function playPainSound(position, damage) {
  if (!audioContext || audioMuted) {
    return;
  }
  const now = audioContext.currentTime;
  const duration = damage >= 24 ? 0.48 : 0.34;
  const pitch = 118 + Math.random() * 42;
  const voice = audioContext.createOscillator();
  const formant = audioContext.createBiquadFilter();
  const gain = connectSoundNode(voice, 0.28, position);
  voice.type = "sawtooth";
  voice.frequency.setValueAtTime(pitch, now);
  voice.frequency.exponentialRampToValueAtTime(pitch * 0.68, now + duration);
  formant.type = "bandpass";
  formant.frequency.setValueAtTime(470 + Math.random() * 170, now);
  formant.Q.setValueAtTime(1.2, now);
  voice.disconnect();
  voice.connect(formant);
  formant.connect(gain);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.045);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  voice.start(now);
  voice.stop(now + duration);
  playNoise(duration * 0.8, 0.075, "bandpass", 850, position);
}

function playZoneAlarm() {
  if (!audioContext || audioMuted) {
    return;
  }
  const sound = () => {
    playTone(960, 620, 0.16, 0.48, "square");
    window.setTimeout(() => playTone(720, 480, 0.12, 0.42, "square"), 110);
  };
  if (audioContext.state === "suspended") {
    audioContext.resume().then(sound).catch(() => {
      statusElement.textContent = "No se pudo iniciar la alarma de fase.";
    });
    return;
  }
  sound();
}

function playPickupSound() {
  playTone(640, 880, 0.09, 0.11, "sine");
  window.setTimeout(() => playTone(880, 1120, 0.1, 0.08, "sine"), 65);
}

function playFootstepSound() {
  playNoise(0.075, 0.09, "lowpass", 250);
  playTone(105, 65, 0.07, 0.1, "triangle");
}

function spawnFxParticle(options) {
  const mesh = new THREE.Mesh(options.geometry, options.material.clone());
  mesh.position.copy(options.position);
  mesh.scale.setScalar(options.size || 1);
  mesh.material.transparent = true;
  mesh.material.userData.baseOpacity = options.opacity ?? mesh.material.opacity ?? 1;
  mesh.material.opacity = mesh.material.userData.baseOpacity;
  if (options.additive) {
    mesh.material.blending = THREE.AdditiveBlending;
    mesh.material.depthWrite = false;
  }
  if (fxParticles.length > 220) {
    const oldest = fxParticles.shift();
    scene.remove(oldest.mesh);
    oldest.mesh.material.dispose();
  }
  scene.add(mesh);
  fxParticles.push({
    mesh,
    velocity: options.velocity || new THREE.Vector3(),
    lifetime: options.lifetime,
    maxLife: options.lifetime,
    gravity: options.gravity ?? 9,
    drag: options.drag ?? 0.12,
    grow: options.grow ?? 0,
    fade: options.fade !== false,
    spin: options.spin || 0
  });
}

function spawnFxLight(position, color, intensity, range, lifetime) {
  const light = new THREE.PointLight(color, intensity, range, 2);
  light.position.copy(position);
  scene.add(light);
  fxLights.push({ light, lifetime, maxLife: lifetime, intensity });
}

function spawnDust(position, count = 4) {
  for (let i = 0; i < count; i += 1) {
    spawnFxParticle({
      geometry: dustGeometry,
      material: fxMaterials.dust,
      position: position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.08, (Math.random() - 0.5) * 0.4)),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.7, (Math.random() - 0.5) * 0.8),
      lifetime: 0.35 + Math.random() * 0.25,
      gravity: 1.2,
      grow: 1.8,
      size: 0.6 + Math.random() * 0.5
    });
  }
}

function spawnImpactSparks(position, direction) {
  const origin = position.clone();
  origin.y = Math.max(0.05, origin.y);
  for (let i = 0; i < 8; i += 1) {
    spawnFxParticle({
      geometry: sparkGeometry,
      material: fxMaterials.spark,
      position: origin,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 6 + (direction?.x || 0) * -2,
        1.2 + Math.random() * 4,
        (Math.random() - 0.5) * 6 + (direction?.z || 0) * -2
      ),
      lifetime: 0.18 + Math.random() * 0.16,
      gravity: 14,
      additive: true,
      size: 0.5 + Math.random() * 0.8
    });
  }
}

function spawnMuzzleFlash(origin, direction) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xfff1b0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  flash.position.copy(origin);
  scene.add(flash);
  muzzleFlashes.push({ mesh: flash, age: 0 });
  spawnFxLight(origin, 0xffd27a, 8, 8, 0.08);
  for (let i = 0; i < 5; i += 1) {
    spawnFxParticle({
      geometry: sparkGeometry,
      material: fxMaterials.spark,
      position: origin.clone(),
      velocity: direction
        .clone()
        .multiplyScalar(6 + Math.random() * 8)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2)),
      lifetime: 0.08 + Math.random() * 0.08,
      gravity: 2,
      additive: true,
      size: 0.4
    });
  }
}

function updateVisualEffects(delta) {
  for (let i = fxParticles.length - 1; i >= 0; i -= 1) {
    const particle = fxParticles[i];
    particle.lifetime -= delta;
    particle.velocity.y -= particle.gravity * delta;
    particle.velocity.multiplyScalar(1 - particle.drag * delta * 8);
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    if (particle.spin) {
      particle.mesh.rotation.x += particle.spin * delta;
      particle.mesh.rotation.z += particle.spin * 0.7 * delta;
    }
    const lifeRatio = Math.max(0, particle.lifetime / particle.maxLife);
    if (particle.grow) {
      particle.mesh.scale.setScalar(particle.mesh.scale.x + particle.grow * delta);
    }
    if (particle.fade && particle.mesh.material) {
      particle.mesh.material.opacity =
        (particle.mesh.material.userData.baseOpacity || 1) * lifeRatio;
    }
    if (particle.lifetime <= 0 || particle.mesh.position.y < -0.2) {
      scene.remove(particle.mesh);
      particle.mesh.material.dispose();
      fxParticles.splice(i, 1);
    }
  }

  for (let i = fxLights.length - 1; i >= 0; i -= 1) {
    const entry = fxLights[i];
    entry.lifetime -= delta;
    entry.light.intensity = entry.intensity * Math.max(0, entry.lifetime / entry.maxLife);
    if (entry.lifetime <= 0) {
      scene.remove(entry.light);
      fxLights.splice(i, 1);
    }
  }

  for (let i = muzzleFlashes.length - 1; i >= 0; i -= 1) {
    const flash = muzzleFlashes[i];
    flash.age += delta;
    flash.mesh.scale.setScalar(1 + flash.age * 8);
    flash.mesh.material.opacity = Math.max(0, 0.9 - flash.age * 12);
    if (flash.age >= 0.08) {
      scene.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      flash.mesh.material.dispose();
      muzzleFlashes.splice(i, 1);
    }
  }

  if (hitFlashElement) {
    hitFlashElement.classList.toggle("is-active", performance.now() < hitFlashUntil);
  }
}

function addBloodEffect(player) {
  if (!player) {
    return;
  }
  const origin = player.position.clone();
  origin.y += player.scale.y < 0.8 ? 0.9 : 1.15;
  for (let i = 0; i < 16; i += 1) {
    if (bloodParticles.length >= 96) {
      const oldest = bloodParticles.shift();
      scene.remove(oldest.mesh);
    }
    const particle = new THREE.Mesh(bloodParticleGeometry, bloodParticleMaterial.clone());
    particle.position.copy(origin);
    scene.add(particle);
    bloodParticles.push({
      mesh: particle,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 5.5,
        1.1 + Math.random() * 3.8,
        (Math.random() - 0.5) * 5.5
      ),
      lifetime: 0.42 + Math.random() * 0.28
    });
  }
  spawnImpactSparks(origin);
}

function explodePlayer(player) {
  if (!player) {
    return;
  }
  const origin = player.position.clone();
  origin.y += 1;
  addBloodEffect(player);

  const burst = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xd9273e,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  burst.position.copy(origin);
  burst.scale.setScalar(0.18);
  scene.add(burst);
  const shockwave = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.42, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff6472,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  shockwave.rotation.x = -Math.PI / 2;
  shockwave.position.set(origin.x, 0.08, origin.z);
  scene.add(shockwave);
  grenadeExplosions.push({ mesh: burst, shockwave, age: 0 });
  spawnFxLight(origin, 0xff1e36, 13, 18, 0.3);
  playExplosionSound(origin);
  if (player.userData.playerId === localPlayerId) {
    cameraShake = Math.max(cameraShake, 0.8);
  }
  player.visible = false;
  for (let i = 0; i < 18; i += 1) {
    spawnFxParticle({
      geometry: bloodParticleGeometry,
      material: bloodParticleMaterial,
      position: origin.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        1 + Math.random() * 8,
        (Math.random() - 0.5) * 12
      ),
      lifetime: 0.55 + Math.random() * 0.35,
      gravity: 8,
      size: 0.75 + Math.random() * 1.1
    });
  }
}

function forwardFromYaw(yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

const playerSoldierLoader = new GLTFLoader();
const playerSoldierUrls = {
  wolf: "/assets/modelos/adventurer/adventurer.glb.glb",
  sheep: "/assets/modelos/Punk by Quaternius - BTALZymknF.glb"
};
const playerSoldierTemplates = new Map();

function loadPlayerSoldier(variant) {
  if (!playerSoldierTemplates.has(variant)) {
    const request = new Promise((resolve, reject) => {
      playerSoldierLoader.load(playerSoldierUrls[variant], (gltf) => {
        resolve(gltf);
      }, undefined, reject);
    });
    playerSoldierTemplates.set(variant, request);
  }
  return playerSoldierTemplates.get(variant);
}

function createPlayer(id, state) {
  const root = new THREE.Group();
  root.position.set(state.position.x, state.position.y || 0, state.position.z);
  root.rotation.y = state.yaw || 0;
  root.userData.playerId = id;
  root.userData.weaponType = state.weaponType || null;
  root.userData.weaponAmmo = state.weaponAmmo || 0;
  root.userData.rifleVariant = playerRifleVariants.get(id) ?? 0;
  root.userData.pistolVariant = playerPistolVariants.get(id) ?? 0;
  root.userData.health = state.health ?? 100;
  root.userData.aiming = Boolean(state.aiming);
  root.userData.crouching = Boolean(state.crouching);
  root.userData.pickupAnimation = 0;
  root.userData.throwAnimation = 0;
  root.userData.jumpAnimation = 0;
  // Prueba visual: el jugador local controla al Punk y el rival al Adventurer.
  const isWolf = id !== localPlayerId;
  root.userData.species = isWolf ? "wolf" : "sheep";

  const characterPivot = new THREE.Group();
  characterPivot.position.y = 0.82;
  root.add(characterPivot);
  const characterVisual = new THREE.Group();
  characterVisual.position.y = -0.82;
  characterPivot.add(characterVisual);
  root.userData.characterPivot = characterPivot;
  root.userData.characterVisual = characterVisual;
  root.userData.rollStartedAt = 0;
  root.userData.rollDirection = new THREE.Vector3();

  // Figura visible mientras llega el GLB (o si el navegador no puede cargarlo).
  const characterFallback = new THREE.Group();
  if (isWolf) {
    const fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0x8fcaff,
      emissive: 0x276ba0,
      emissiveIntensity: 0.55,
      roughness: 0.82
    });
    const fallbackBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.9, 4, 8),
      fallbackMaterial
    );
    fallbackBody.position.y = 0.82;
    characterFallback.add(fallbackBody);
    const fallbackHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      fallbackMaterial
    );
    fallbackHead.position.y = 1.55;
    characterFallback.add(fallbackHead);
  } else {
    // Este es el rival procedural de la versión anterior; no depende del rig
    // del GLB para ser visible mientras se carga el Punk.
    const fur = new THREE.MeshBasicMaterial({ color: 0xe9e6dc });
    const face = new THREE.MeshBasicMaterial({ color: 0x3a3c42 });
    const muzzle = new THREE.MeshBasicMaterial({ color: 0xe6ded0 });
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xf4eee0 });
    const eyeDark = new THREE.MeshBasicMaterial({ color: 0x171b20 });
    const nose = new THREE.MeshBasicMaterial({ color: 0x202328 });
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const addSheepPart = (geometry, material, position, scale, parent = characterFallback) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      if (scale) mesh.scale.set(...scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    addSheepPart(sphere, fur, [0, 1.05, 0], [0.42, 0.58, 0.31]);
    const head = new THREE.Group();
    head.position.set(0, 1.77, -0.02);
    characterFallback.add(head);
    addSheepPart(sphere, face, [0, -0.015, -0.035], [0.26, 0.3, 0.25], head);
    addSheepPart(sphere, muzzle, [0, -0.12, -0.23], [0.16, 0.12, 0.1], head);
    addSheepPart(sphere, nose, [0, -0.08, -0.315], [0.055, 0.045, 0.035], head);
    for (const side of [-1, 1]) {
      addSheepPart(new THREE.ConeGeometry(0.075, 0.24, 6), face,
        [side * 0.28, 0.03, -0.015], [1, 0.65, 1], head);
      addSheepPart(sphere, eyeWhite, [side * 0.13, 0.055, -0.235], [0.055, 0.06, 0.035], head);
      addSheepPart(sphere, eyeDark, [side * 0.13, 0.05, -0.267], [0.027, 0.035, 0.02], head);
    }
    for (const [x, y, z] of [
      [-0.25, 1.2, 0], [0.25, 1.2, 0], [-0.28, 1.02, 0.13],
      [0.28, 1.02, 0.13], [0, 1.37, 0.04], [-0.19, 1.63, 0.02],
      [0.19, 1.63, 0.02]
    ]) {
      addSheepPart(sphere, fur, [x, y, z], [0.19, 0.19, 0.19]);
    }
    addSheepPart(sphere, fur, [0, 1.15, 0.39], [0.16, 0.18, 0.17]);
    for (const x of [-0.2, 0.2]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.72, 0);
      characterFallback.add(leg);
      addSheepPart(new THREE.CylinderGeometry(0.13, 0.16, 0.48, 8), fur,
        [0, -0.22, 0], null, leg);
      addSheepPart(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 8), face,
        [0, -0.56, 0], null, leg);
      addSheepPart(sphere, nose, [0, -0.73, -0.08], [0.16, 0.1, 0.23], leg);
    }
    for (const side of [-1, 1]) {
      const arm = addSheepPart(new THREE.CylinderGeometry(0.1, 0.13, 0.48, 8), fur,
        [side * 0.36, 1.22, -0.015]);
      arm.rotation.z = side * -0.22;
      addSheepPart(sphere, nose, [side * 0.4, 0.98, -0.02], [0.13, 0.11, 0.14]);
    }
  }
  characterVisual.add(characterFallback);

  const heldRifle = createRifle(root.userData.rifleVariant);
  heldRifle.position.set(0.2, 1.0, -0.3);
  heldRifle.visible = state.weaponType === "rifle" && state.weaponAmmo > 0;
  characterVisual.add(heldRifle);
  root.userData.heldRifle = heldRifle;

  const heldPistol = createPistol(root.userData.pistolVariant);
  heldPistol.position.set(0.2, 1.0, -0.2);
  heldPistol.visible = state.weaponType === "pistol" && state.weaponAmmo > 0;
  characterVisual.add(heldPistol);
  root.userData.heldPistol = heldPistol;

  const heldBazooka = createBazooka();
  heldBazooka.position.set(0.25, 1.0, -0.4);
  heldBazooka.visible = state.weaponType === "bazooka" && state.weaponAmmo > 0;
  characterVisual.add(heldBazooka);
  root.userData.heldBazooka = heldBazooka;

  const heldKnife = createKnife();
  heldKnife.position.set(-0.2, 0.9, -0.2);
  heldKnife.visible = Boolean(
    state.hasKnife && (state.knifeEquipped || !state.weaponAmmo)
  );
  characterVisual.add(heldKnife);
  root.userData.heldKnife = heldKnife;
  root.userData.hasKnife = Boolean(state.hasKnife);
  root.userData.knifeEquipped = Boolean(
    state.knifeEquipped || (state.hasKnife && !state.weaponAmmo)
  );

  const heldGrenade = createGrenade();
  heldGrenade.position.set(-0.2, 0.9, -0.1);
  heldGrenade.visible = Boolean(state.grenadeCount);
  characterVisual.add(heldGrenade);
  root.userData.heldGrenade = heldGrenade;

  scene.add(root);
  players.set(id, root);
  if (id !== localPlayerId) {
    const markerCanvas = document.createElement("canvas");
    markerCanvas.width = 256;
    markerCanvas.height = 64;
    const markerContext = markerCanvas.getContext("2d");
    markerContext.fillStyle = "rgba(7, 17, 25, 0.94)";
    markerContext.fillRect(8, 6, 240, 52);
    markerContext.strokeStyle = "#b8f27c";
    markerContext.lineWidth = 4;
    markerContext.stroke();
    markerContext.fillStyle = "#efffdb";
    markerContext.font = "bold 30px sans-serif";
    markerContext.textAlign = "center";
    markerContext.textBaseline = "middle";
    markerContext.fillText("PUNK", 128, 32);
    const markerTexture = new THREE.CanvasTexture(markerCanvas);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true
    }));
    marker.position.set(0, 3, 0);
    marker.scale.set(8, 2, 1);
    root.add(marker);
  }
  
  loadPlayerSoldier(root.userData.species)
    .then((template) => {
      if (players.get(id) !== root) {
        return;
      }
      const model = cloneSkinnedModel(template.scene);
      // El GLB mira al +Z y el juego avanza hacia -Z.
      model.rotation.y = Math.PI;
      model.traverse((node) => {
        if (node.isMesh) {
          // El rig del adventurer tiene bounds que pueden dejar de cubrir la
          // malla al animarse; evita que Three.js lo oculte según el frustum.
          node.frustumCulled = false;
          node.geometry = node.geometry.clone();
          node.material = Array.isArray(node.material)
            ? node.material.map((material) => material.clone())
            : node.material.clone();
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      
      const getStaticMeshBounds = () => {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3();
        model.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          node.geometry.computeBoundingBox();
          if (node.geometry.boundingBox) {
            box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
          }
        });
        return box;
      };
      const bounds = getStaticMeshBounds();
      const size = bounds.getSize(new THREE.Vector3());
      const maxSize = Math.max(size.x, size.y, size.z);
      if (bounds.isEmpty() || !Number.isFinite(maxSize) || maxSize <= 0 || !Number.isFinite(bounds.min.y)) {
        throw new Error("El modelo no devolvió límites 3D válidos.");
      }

      model.scale.setScalar(2.0 / maxSize);
      const scaledBounds = getStaticMeshBounds();
      model.traverse((node) => {
        if (node.isSkinnedMesh) {
          node.skeleton.update();
          node.computeBoundingBox();
        }
      });
      
      // Recalculamos los límites después de escalar para centrarlo y apoyar los pies en el suelo
      if (scaledBounds.isEmpty() || !Number.isFinite(scaledBounds.min.y)) {
        throw new Error("No se pudieron calcular los límites del modelo escalado.");
      }
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -scaledBounds.min.y, -center.z);
      // El respaldo solo queda visible mientras carga o si falla el GLB.
      characterVisual.clear();
      characterVisual.add(model);
      root.userData.soldierModel = model;
      root.userData.soldierJumpBones = [];
      model.traverse((node) => {
        if (node.isBone && (node.name === "UpperArm.L" || node.name === "UpperArm.R")) {
          root.userData.soldierJumpBones.push({
            bone: node,
            direction: node.name.endsWith(".L") ? -1 : 1
          });
        }
      });
      root.userData.soldierAirPose = 0;
      // Se vuelven a insertar en el jugador antes de vincularlas a la muñeca.
      const currentHeldRifle = root.userData.heldRifle || heldRifle;
      const currentHeldPistol = root.userData.heldPistol || heldPistol;
      const currentHeldBazooka = root.userData.heldBazooka || heldBazooka;
      const currentHeldKnife = root.userData.heldKnife || heldKnife;
      characterVisual.add(currentHeldRifle);
      characterVisual.add(currentHeldPistol);
      characterVisual.add(currentHeldBazooka);
      characterVisual.add(currentHeldKnife);
      characterVisual.add(heldGrenade);
      model.updateMatrixWorld(true);
      const weaponHand = model.getObjectByName("Wrist.R");
      if (weaponHand) {
        root.userData.weaponHand = weaponHand;
        [currentHeldRifle, currentHeldPistol, currentHeldBazooka, currentHeldKnife].forEach((weapon) => {
          weaponHand.attach(weapon);
        });
      }

      if (template.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        const clips = new Map(template.animations.map((clip) => [clip.name.split("|").pop(), clip]));
        const actions = new Map(
          [...clips].map(([name, clip]) => [name, mixer.clipAction(clip)])
        );
        const idleAction = actions.get("Idle_Neutral") || actions.get("Idle");
        idleAction?.play();
        root.userData.soldierMixer = mixer;
        root.userData.soldierActions = actions;
        root.userData.soldierAction = idleAction;
        root.userData.soldierActionName = idleAction === actions.get("Idle_Neutral") ? "Idle_Neutral" : "Idle";
        root.userData.soldierForcedUntil = 0;
        root.userData.lastAnimationPosition = root.position.clone();
      }
    })
    .catch((error) => {
      console.error("No se pudo cargar el modelo del jugador:", error);
    });
  playerTargets.set(id, {
    position: root.position.clone(),
    yaw: root.rotation.y,
    crouching: Boolean(state.crouching),
    aiming: Boolean(state.aiming),
    rolling: Boolean(state.rolling)
  });
  root.scale.y = state.crouching ? 0.75 : 1;
  return root;
}

function addPlayer(player) {
  if (player.id === localPlayerId || players.has(player.id)) {
    return;
  }
  createPlayer(player.id, player);
}

function removePlayer(id) {
  const root = players.get(id);
  if (!root) {
    return;
  }

  scene.remove(root);
  root.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => {
          if (!sharedPropMaterials.has(material)) {
            material.dispose();
          }
        });
      } else if (!sharedPropMaterials.has(child.material)) {
        child.material.dispose();
      }
    }
  });
  players.delete(id);
  playerRifleVariants.delete(id);
  playerPistolVariants.delete(id);
  playerTargets.delete(id);
}

function updatePlayerTarget(player) {
  const target = playerTargets.get(player.id);
  if (!target) {
    return;
  }

  target.position.set(
    player.position.x,
    player.position.y || 0,
    player.position.z
  );
  target.yaw = player.yaw || 0;
  target.crouching = Boolean(player.crouching);
  target.aiming = Boolean(player.aiming);
  const rolling = Boolean(player.rolling);
  if (rolling && !target.rolling) {
    const root = players.get(player.id);
    if (root) root.userData.rollStartedAt = performance.now();
  } else if (!rolling && target.rolling) {
    const root = players.get(player.id);
    if (root) {
      root.userData.rollStartedAt = 0;
      root.userData.characterPivot.rotation.x = 0;
    }
  }
  target.rolling = rolling;
}

function playSoldierAnimation(player, name, oneShot = true) {
  const userData = player?.userData;
  const action = userData?.soldierActions?.get(name);
  if (!action) return 0;

  const now = performance.now();
  if (oneShot && userData.soldierAction === action && userData.soldierForcedUntil > now) {
    return action.getClip().duration;
  }

  userData.soldierAction?.fadeOut(0.1);
  action.reset();
  action.enabled = true;
  action.clampWhenFinished = oneShot;
  action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
  action.fadeIn(0.1).play();
  userData.soldierAction = action;
  userData.soldierActionName = name;
  userData.soldierForcedUntil = oneShot ? now + action.getClip().duration * 1000 : 0;
  return action.getClip().duration;
}

function startPlayerDeathAnimation(player) {
  if (!player || player.userData.deathAnimationScheduled) return;
  player.userData.deathAnimationScheduled = true;
  const deathRoundStartedAt = roundStartedAt;
  const duration = playSoldierAnimation(player, "Death");
  window.setTimeout(() => {
    if (roundStartedAt === deathRoundStartedAt) {
      explodePlayer(player);
    }
  }, Math.max(0, duration * 1000 - 120));
}

function updatePlayerAnimations(delta) {
  players.forEach((player) => {
    if (player.userData.soldierMixer) {
      const previousPosition = player.userData.lastAnimationPosition;
      const distance = previousPosition
        ? Math.hypot(player.position.x - previousPosition.x, player.position.z - previousPosition.z)
        : 0;
      const speed = delta > 0 ? distance / delta : 0;
      player.userData.animationSpeed = speed;
      let nextName = "Idle_Neutral";
      const actions = player.userData.soldierActions;
      const hasFirearm = Boolean(
        player.userData.weaponType &&
        player.userData.weaponAmmo > 0 &&
        !player.userData.knifeEquipped
      );
      const moveX = previousPosition ? player.position.x - previousPosition.x : 0;
      const moveZ = previousPosition ? player.position.z - previousPosition.z : 0;
      const yaw = player.rotation.y;
      const rightMovement = Math.cos(yaw) * moveX - Math.sin(yaw) * moveZ;
      const forwardMovement = -Math.sin(yaw) * moveX - Math.cos(yaw) * moveZ;
      if (performance.now() >= player.userData.soldierForcedUntil) {
        if (speed >= 0.35 && player.userData.aiming && hasFirearm && actions.has("Run_Shoot")) {
          nextName = "Run_Shoot";
        } else if (speed >= 0.35 && Math.abs(rightMovement) > Math.abs(forwardMovement)) {
          const sideAnimation = rightMovement < 0 ? "Run_Left" : "Run_Right";
          nextName = actions.has(sideAnimation) ? sideAnimation : "Walk";
        } else if (speed >= 0.35 && forwardMovement < 0 && actions.has("Run_Back")) {
          nextName = "Run_Back";
        } else if (speed >= 0.35 && speed >= 8.4 && actions.has("Run")) {
          nextName = "Run";
        } else if (speed >= 0.35 && actions.has("Walk")) {
          nextName = "Walk";
        } else if (
          player.userData.aiming &&
          (player.userData.weaponType === "rifle" || player.userData.weaponType === "bazooka") &&
          hasFirearm &&
          actions.has("Idle_Gun")
        ) {
          nextName = "Idle_Gun";
        } else if (player.userData.aiming && hasFirearm && actions.has("Idle_Gun_Pointing")) {
          nextName = "Idle_Gun_Pointing";
        } else if (player.userData.crouching) {
          nextName = actions.has("Idle_Neutral") ? "Idle_Neutral" : "Idle";
        } else if (player.userData.knifeEquipped && actions.has("Idle_Sword")) {
          nextName = "Idle_Sword";
        } else if (hasFirearm && actions.has("Idle_Gun")) {
          nextName = "Idle_Gun";
        } else if (!actions.has(nextName)) {
          nextName = "Idle";
        }
        if (nextName !== player.userData.soldierActionName) {
          playSoldierAnimation(player, nextName, false);
        }
      }
      if (player.userData.playerId === localPlayerId) {
        player.userData.crouching = keys.has("ControlLeft");
      }
      if (previousPosition) previousPosition.copy(player.position);
      player.userData.soldierMixer.update(delta);
      if (player.userData.soldierModel) {
        const airborne = player.position.y > 0.12;
        const blend = Math.min(1, delta * 10);
        player.userData.soldierAirPose += ((airborne ? 1 : 0) - player.userData.soldierAirPose) * blend;
        player.userData.soldierModel.rotation.x +=
          ((airborne ? -0.12 : 0) - player.userData.soldierModel.rotation.x) * blend;
        player.userData.soldierJumpBones?.forEach(({ bone, direction }) => {
          const raiseArm = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            direction * 0.72 * player.userData.soldierAirPose
          );
          bone.quaternion.multiply(raiseArm);
        });
      }
    }
  });
}

function updateBloodParticles(delta) {
  for (let i = bloodParticles.length - 1; i >= 0; i -= 1) {
    const particle = bloodParticles[i];
    particle.lifetime -= delta;
    particle.velocity.y -= 8 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.scale.setScalar(Math.max(0.12, particle.lifetime * 1.8));
    if (particle.lifetime <= 0 || particle.mesh.position.y < 0) {
      scene.remove(particle.mesh);
      if (particle.mesh.material !== bloodParticleMaterial) {
        particle.mesh.material.dispose();
      }
      bloodParticles.splice(i, 1);
    }
  }
}

function cameraAimDirection() {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  return raycaster.ray.direction.clone().normalize();
}

function projectileHitsRockBox(origin, direction, maxDistance, rock) {
  projectileColliderCenter.set(rock.x, rock.y, rock.z);
  projectileColliderInverseRotation
    .setFromEuler(projectileColliderEuler.set(rock.rotationX, rock.rotationY, rock.rotationZ))
    .invert();
  projectileColliderOrigin
    .copy(origin)
    .sub(projectileColliderCenter)
    .applyQuaternion(projectileColliderInverseRotation);
  projectileColliderDirection
    .copy(direction)
    .applyQuaternion(projectileColliderInverseRotation);

  let near = 0;
  let far = maxDistance;
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const axis = axisIndex === 0 ? "x" : axisIndex === 1 ? "y" : "z";
    const halfExtent = axisIndex === 0
      ? rock.colliderHalfExtents.x
      : axisIndex === 1
        ? rock.colliderHalfExtents.y
        : rock.colliderHalfExtents.z;
    const rayComponent = projectileColliderDirection[axis];
    const originComponent = projectileColliderOrigin[axis];
    if (Math.abs(rayComponent) < 1e-8) {
      if (Math.abs(originComponent) > halfExtent) return false;
      continue;
    }
    let first = (-halfExtent - originComponent) / rayComponent;
    let second = (halfExtent - originComponent) / rayComponent;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far > 0 && near < maxDistance;
}

function fireProjectile(id, position, yaw, crouching, aimDirection, weaponType, maxDistance = Infinity) {
  const muzzleOffset = new THREE.Vector3(0.38, crouching ? 0.82 : 1.25, -0.7)
    .applyAxisAngle(worldUp, yaw);
  const origin = new THREE.Vector3(position.x, position.y, position.z).add(muzzleOffset);
  const direction = aimDirection
    ? new THREE.Vector3(aimDirection.x, aimDirection.y, aimDirection.z).normalize()
    : forwardFromYaw(yaw);

  let mesh;
  if (weaponType === "bazooka") {
    mesh = new THREE.Group();
    const body = new THREE.Mesh(bazookaProjectileBodyGeometry, bazookaProjectileBodyMaterial);
    const tip = new THREE.Mesh(bazookaProjectileTipGeometry, bazookaProjectileTipMaterial);
    tip.position.z = 0.62;
    mesh.add(body, tip);
  } else {
    mesh = new THREE.Mesh(projectileGeometry, projectileMaterial.clone());
  }
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);
  projectiles.push({
    mesh,
    weaponType,
    velocity: direction.clone().multiplyScalar(weaponType === "bazooka" ? 36 : 52),
    travelled: 0,
    maxDistance,
    // Desde un extremo de la cancha al muro del fondo hay unos 105 m.
    lifetime: weaponType === "bazooka" ? 3.4 : 1.4
  });
  spawnMuzzleFlash(origin, direction);
  if (id === localPlayerId) {
    cameraShake = Math.max(cameraShake, isAiming ? 0.035 : 0.07);
  }
}

function setGrenadeCount(count) {
  grenadeCount = count;
  if (grenadeCountElement) {
    grenadeCountElement.textContent = String(count);
  }
  if (localPlayer && localPlayer.userData.heldGrenade) {
    localPlayer.userData.heldGrenade.visible = count > 0;
  }
}

function setWeaponInventory(type, ammo) {
  weaponType = ammo > 0 ? type : null;
  weaponAmmo = ammo;
  if (ammo === 0 && hasKnife) {
    knifeEquipped = true;
  }
  if (ammo === 0) {
    isFiring = false;
  }
  weaponAmmoElement.textContent = String(ammo);
  weaponCapacityElement.textContent =
    weaponType === "rifle" ? "30" : weaponType === "pistol" ? "12" : weaponType === "bazooka" ? "1" : "0";
  weaponStatusElement.textContent = knifeEquipped && hasKnife
    ? "MACHETE"
    : weaponType === "bazooka"
      ? "BAZOOKA"
      : weaponType
    ? weaponType === "pistol"
      ? "PISTOLA"
      : "RIFLE AUTOMÁTICO"
    : hasKnife
      ? "MACHETE"
      : "SIN ARMA";
  if (localPlayer) {
    localPlayer.userData.weaponType = weaponType;
    localPlayer.userData.weaponAmmo = weaponAmmo;
    localPlayer.userData.knifeEquipped = knifeEquipped;
    localPlayer.userData.heldRifle.visible =
      !knifeEquipped && weaponType === "rifle";
    localPlayer.userData.heldPistol.visible =
      !knifeEquipped && weaponType === "pistol";
    localPlayer.userData.heldBazooka.visible = !knifeEquipped && weaponType === "bazooka";
    localPlayer.userData.heldKnife.visible = hasKnife && knifeEquipped;
  }
}

function setKnifeInventory(hasItem, equipped = hasItem && weaponAmmo === 0) {
  hasKnife = hasItem;
  knifeEquipped = hasItem && equipped;
  if (localPlayer) {
    localPlayer.userData.hasKnife = hasItem;
    localPlayer.userData.knifeEquipped = knifeEquipped;
    localPlayer.userData.heldRifle.visible =
      !knifeEquipped && weaponType === "rifle";
    localPlayer.userData.heldPistol.visible =
      !knifeEquipped && weaponType === "pistol";
    localPlayer.userData.heldKnife.visible = hasItem && knifeEquipped;
  }
  weaponStatusElement.textContent =
    hasItem && knifeEquipped
      ? "MACHETE"
      : weaponType === "pistol"
        ? "PISTOLA"
        : weaponType === "rifle"
          ? "RIFLE AUTOMÁTICO"
          : "SIN ARMA";
}

function setPlayerHealth(id, health) {
  if (id === localPlayerId) {
    playerHealth = health;
    healthValueElement.textContent = `${Math.ceil(health)} HP`;
    healthBarElement.value = health;
    document.body.classList.toggle("low-health", health <= 35);
  }
  const player = players.get(id);
  if (player) {
    player.userData.health = health;
  }
}

function updateSeriesState(state) {
  seriesState = state?.enabled
    ? state
    : { enabled: false, roundNumber: 1, maxRounds: 3, scores: {} };
}

function getSeriesStatusText() {
  if (!seriesState.enabled) {
    return "";
  }
  const scores = seriesState.scores || {};
  const localWins = Number(scores[localPlayerId] || 0);
  const opponentWins = Number(
    Object.entries(scores).find(([id]) => id !== localPlayerId)?.[1] || 0
  );
  return ` · MEJOR DE 3 ${localWins}-${opponentWins} · PARTIDA ${seriesState.roundNumber}/${seriesState.maxRounds}`;
}

function updateRoundState(state) {
  if (!state) {
    return;
  }
  if (state.startedAt !== roundStartedAt) {
    roundStartedAt = state.startedAt;
    lastTeleportStep = 0;
    teleportRng = createArenaRandom(9417);
  }
  roundPhase = state.phase;
  safeRadius = state.safeRadius;
  roundEnded = Boolean(state.ended);
  phaseRemainingMs = state.phaseRemainingMs;
  phaseStateReceivedAt = performance.now();
  escapeOpen = Boolean(state.escapeOpen);

  if (roundPhase === 0) {
    roundStatusElement.textContent =
      `ESPERANDO AL SEGUNDO JUGADOR${getSeriesStatusText()}`;
    roundStatusElement.classList.remove("is-warning");
    return;
  }
  const phaseNames = [
    "",
    "FASE 1 · FRANJA 1",
    "FASE 2 · FRANJA 2",
    "FASE 3 · FRANJA 3",
    "CÍRCULO CENTRAL"
  ];
  const phaseSeconds = Math.ceil(phaseRemainingMs / 1000);
  const minutes = String(Math.floor(phaseSeconds / 60)).padStart(2, "0");
  const seconds = String(phaseSeconds % 60).padStart(2, "0");
  roundStatusElement.classList.toggle("is-warning", escapeOpen);
  roundStatusElement.textContent = escapeOpen
    ? `${phaseNames[roundPhase]} · ¡AVANZA! · ${minutes}:${seconds}${getSeriesStatusText()}`
    : `${phaseNames[roundPhase]} · ${minutes}:${seconds}${getSeriesStatusText()}`;
}

function updateZoneWarning(now) {
  const remainingMs = Math.max(
    0,
    phaseRemainingMs - (now - phaseStateReceivedAt)
  );
  const warningActive =
    escapeOpen && roundPhase >= 1 && roundPhase <= 3 && remainingMs > 0;
  const warningElapsedSeconds = (5000 - remainingMs) / 1000;
  const blinkPeriodMs = Math.max(180, 850 - warningElapsedSeconds * 130);
  const blinkOn = Math.sin((now / blinkPeriodMs) * Math.PI * 2) > 0;
  const activeZone = roundPhase - 1;

  zoneWarningOverlays.forEach((overlay, index) => {
    const closingZone = index === activeZone || index === 5 - activeZone;
    overlay.material.opacity =
      warningActive && closingZone ? (blinkOn ? 0.62 : 0.08) : 0;
  });

  if (warningActive) {
    if (now - lastWarningSoundAt >= blinkPeriodMs) {
      playZoneAlarm();
      lastWarningSoundAt = now;
    }
  } else {
    lastWarningSoundAt = -Infinity;
  }
}

function removeGrenadePickup(id) {
  const grenade = grenadePickups.get(id);
  if (!grenade) {
    return;
  }
  scene.remove(grenade);
  grenadePickups.delete(id);
}

function removeRiflePickup(id) {
  const rifle = riflePickups.get(id);
  if (!rifle) {
    return;
  }
  scene.remove(rifle);
  riflePickups.delete(id);
}

function removePistolPickup(id) {
  const pistol = pistolPickups.get(id);
  if (!pistol) {
    return;
  }
  scene.remove(pistol);
  pistolPickups.delete(id);
}

function removeKnifePickup(id) {
  const knife = knifePickups.get(id);
  if (!knife) {
    return;
  }
  scene.remove(knife);
  knifePickups.delete(id);
}

function syncGrenadePickups(serverGrenades) {
  const available = new Map(
    (serverGrenades || []).map((grenade) => [grenade.id, grenade])
  );

  for (const id of grenadePickups.keys()) {
    if (!available.has(id)) {
      removeGrenadePickup(id);
    }
  }

  available.forEach((grenade, id) => {
    if (grenadePickups.has(id)) {
      return;
    }
    const pickup = createGroundGrenade(grenade.position);
    pickup.userData.pickupId = id;
    scene.add(pickup);
    grenadePickups.set(id, pickup);
  });
}

function syncRiflePickups(serverRifles) {
  const available = new Map(
    (serverRifles || []).map((rifle) => [rifle.id, rifle])
  );

  for (const id of riflePickups.keys()) {
    if (!available.has(id)) {
      removeRiflePickup(id);
    }
  }

  available.forEach((rifle, id) => {
    if (riflePickups.has(id)) {
      return;
    }
    const pickup = createGroundRifle(rifle.position, id);
    pickup.userData.pickupId = id;
    scene.add(pickup);
    riflePickups.set(id, pickup);
  });
}

function syncPistolPickups(serverPistols) {
  const available = new Map(
    (serverPistols || []).map((pistol) => [pistol.id, pistol])
  );
  for (const id of pistolPickups.keys()) {
    if (!available.has(id)) {
      removePistolPickup(id);
    }
  }
  available.forEach((pistol, id) => {
    if (pistolPickups.has(id)) {
      return;
    }
    const pickup = createGroundPistol(pistol.position, id);
    pickup.userData.pickupId = id;
    scene.add(pickup);
    pistolPickups.set(id, pickup);
  });
}

function syncKnifePickups(serverKnives) {
  const available = new Map(
    (serverKnives || []).map((knife) => [knife.id, knife])
  );
  for (const id of knifePickups.keys()) {
    if (!available.has(id)) {
      removeKnifePickup(id);
    }
  }
  available.forEach((knife, id) => {
    if (knifePickups.has(id)) {
      return;
    }
    const pickup = createGroundKnife(knife.position);
    pickup.userData.pickupId = id;
    scene.add(pickup);
    knifePickups.set(id, pickup);
  });
}

function findNearbyPickup() {
  if (!localPlayer) {
    return null;
  }
  if (
    Math.hypot(localPlayer.position.x, localPlayer.position.z) > safeRadius
  ) {
    return null;
  }

  let closest = null;
  let closestDistance = Infinity;
  if (roundPhase === 1 && weaponAmmo === 0) grenadePickups.forEach((grenade, id) => {
    if (Math.hypot(grenade.position.x, grenade.position.z) > safeRadius) {
      return;
    }
    const distance = Math.hypot(
      localPlayer.position.x - grenade.position.x,
      localPlayer.position.z - grenade.position.z
    );
    if (distance < grenadePickupRange && distance < closestDistance) {
      closest = { kind: "bazooka", id };
      closestDistance = distance;
    }
  });

  if (roundPhase === 2) riflePickups.forEach((rifle, id) => {
    if (Math.hypot(rifle.position.x, rifle.position.z) > safeRadius) {
      return;
    }
    const distance = Math.hypot(
      localPlayer.position.x - rifle.position.x,
      localPlayer.position.z - rifle.position.z
    );
    if (
      weaponAmmo === 0 &&
      distance < riflePickupRange &&
      distance < closestDistance
    ) {
      closest = { kind: "rifle", id };
      closestDistance = distance;
    }
  });

  if (roundPhase === 3) pistolPickups.forEach((pistol, id) => {
    if (Math.hypot(pistol.position.x, pistol.position.z) > safeRadius) {
      return;
    }
    const distance = Math.hypot(
      localPlayer.position.x - pistol.position.x,
      localPlayer.position.z - pistol.position.z
    );
    if (
      weaponAmmo === 0 &&
      distance < pistolPickupRange &&
      distance < closestDistance
    ) {
      closest = { kind: "pistol", id };
      closestDistance = distance;
    }
  });

  if (roundPhase === 3 && !hasKnife) {
    knifePickups.forEach((knife, id) => {
      if (Math.hypot(knife.position.x, knife.position.z) > safeRadius) {
        return;
      }
      const distance = Math.hypot(
        localPlayer.position.x - knife.position.x,
        localPlayer.position.z - knife.position.z
      );
      if (distance < knifePickupRange && distance < closestDistance) {
        closest = { kind: "knife", id };
        closestDistance = distance;
      }
    });
  }

  return closest;
}

function pickUpNearbyItem() {
  if (!socket || !localPlayer) {
    return;
  }

  const pickup = findNearbyPickup();
  if (!pickup) {
    return;
  }
  localPlayer.userData.pickupAnimation = 0.72;
  playSoldierAnimation(localPlayer, "Interact");
  const events = {
    bazooka: "grenade:pickup",
    rifle: "rifle:pickup",
    pistol: "pistol:pickup",
    knife: "knife:pickup"
  };
  socket.emit(events[pickup.kind], pickup.id);
}

function addDroppedWeapon({ id, position, type, ammo }) {
  const pickupMap = type === "rifle" ? riflePickups : pistolPickups;
  if (pickupMap.has(id)) {
    return;
  }
  const pickup =
    type === "rifle"
      ? createGroundRifle(position, id)
      : createGroundPistol(position, id);
  pickup.userData.pickupId = id;
  pickup.userData.ammo = ammo;
  scene.add(pickup);
  pickupMap.set(id, pickup);
}

function throwGrenade() {
  if (!socket || grenadeCount < 1) {
    return false;
  }

  const now = performance.now();
  if (now - lastGrenadeThrowAt < 500) {
    return true;
  }

  lastGrenadeThrowAt = now;
  localPlayer.userData.throwAnimation = 0.82;
  playSoldierAnimation(localPlayer, "Interact");
  socket.emit("grenade:throw", { direction: cameraAimDirection() });
  return true;
}

function spawnThrownGrenade(grenade) {
  if (thrownGrenades.has(grenade.id)) {
    return;
  }

  const mesh = createGrenade();
  mesh.position.set(
    grenade.position.x,
    grenade.position.y,
    grenade.position.z
  );
  scene.add(mesh);
  thrownGrenades.set(grenade.id, {
    mesh,
    velocity: new THREE.Vector3(
      grenade.velocity.x,
      grenade.velocity.y,
      grenade.velocity.z
    ),
    detonateAt: grenade.detonateAt,
    resting: false
  });
}

function detonateGrenade(id, impactPosition) {
  const grenade = thrownGrenades.get(id);
  if (!grenade) {
    return;
  }
  if (impactPosition) {
    grenade.mesh.position.set(
      impactPosition.x,
      impactPosition.y,
      impactPosition.z
    );
  }

  const origin = grenade.mesh.position.clone();
  origin.y = Math.max(origin.y, 0.4);

  const burst = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffbc69,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  burst.position.copy(origin);
  burst.scale.setScalar(0.2);
  scene.add(burst);

  const shockwave = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.45, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffe6a8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  shockwave.rotation.x = -Math.PI / 2;
  shockwave.position.copy(origin);
  shockwave.position.y = 0.08;
  scene.add(shockwave);

  grenadeExplosions.push({ mesh: burst, shockwave, age: 0 });
  spawnFxLight(origin, 0xff8a3a, 16, 22, 0.35);
  cameraShake = Math.max(cameraShake, 0.55);

  for (let i = 0; i < 22; i += 1) {
    spawnFxParticle({
      geometry: sparkGeometry,
      material: fxMaterials.fire,
      position: origin.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        2 + Math.random() * 8,
        (Math.random() - 0.5) * 10
      ),
      lifetime: 0.28 + Math.random() * 0.22,
      gravity: 10,
      additive: true,
      size: 0.7 + Math.random()
    });
  }
  for (let i = 0; i < 10; i += 1) {
    spawnFxParticle({
      geometry: smokeGeometry,
      material: fxMaterials.smoke,
      position: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6)),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.1 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4),
      lifetime: 0.7 + Math.random() * 0.45,
      gravity: -0.6,
      grow: 2.4,
      opacity: 0.4,
      size: 1.1
    });
  }
  for (let i = 0; i < 8; i += 1) {
    spawnFxParticle({
      geometry: debrisGeometry,
      material: fxMaterials.debris,
      position: origin.clone(),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 6, (Math.random() - 0.5) * 8),
      lifetime: 0.55 + Math.random() * 0.3,
      gravity: 16,
      spin: 8,
      fade: false,
      size: 0.8 + Math.random() * 1.2
    });
  }

  scene.remove(grenade.mesh);
  thrownGrenades.delete(id);
}

function shoot() {
  if (!localPlayer || !socket || roundEnded || playerHealth <= 0) {
    return;
  }
  if (throwGrenade()) {
    return;
  }

  if (weaponAmmo < 1) {
    if (hasKnife) {
      knifeEquipped = true;
      setWeaponInventory(weaponType, weaponAmmo);
      socket.emit("knife:attack");
    } else {
      playDryFireSound();
    }
    return;
  }

  if (knifeEquipped && hasKnife) {
    socket.emit("knife:attack");
    return;
  }

  isFiring = true;
  fireAutomaticShot(performance.now());
}

function fireAutomaticShot(now) {
  if (
    !isFiring ||
    !socket ||
    weaponAmmo < 1 ||
    roundEnded ||
    now - lastShotAt <
      (weaponType === "pistol" ? 300 : automaticFireInterval)
  ) {
    return;
  }

  lastShotAt = now;
  socket.emit("player:shoot", { direction: cameraAimDirection() });
}

function sendPlayerState(now) {
  if (!localPlayer || now - lastMoveSentAt < 50) {
    return;
  }

  const state = {
    x: localPlayer.position.x,
    y: localPlayer.position.y,
    z: localPlayer.position.z,
    yaw: localPlayer.rotation.y,
    crouching: keys.has("ControlLeft"),
    aiming: isAiming,
    rolling: localPlayer.userData.rollStartedAt > 0
  };
  if (
    lastSentState &&
    state.x === lastSentState.x &&
    state.y === lastSentState.y &&
    state.z === lastSentState.z &&
    state.yaw === lastSentState.yaw &&
    state.crouching === lastSentState.crouching &&
    state.aiming === lastSentState.aiming &&
    state.rolling === lastSentState.rolling
  ) {
    return;
  }

  socket.emit("player:move", {
    position: { x: state.x, y: state.y, z: state.z },
    yaw: state.yaw,
    crouching: state.crouching,
    aiming: state.aiming,
    rolling: state.rolling
  });
  lastSentState = state;
  lastMoveSentAt = now;
}

function assignPistolVariants(roster) {
  playerPistolVariants.clear();
  roster.forEach((player, index) => {
    playerPistolVariants.set(player.id, index % 2);
  });
}

function assignRifleVariants(roster) {
  playerRifleVariants.clear();
  roster.forEach((player, index) => {
    playerRifleVariants.set(player.id, index % 2);
  });
}

function assignJoinedPlayerPistolVariant(playerId) {
  if (playerPistolVariants.has(playerId)) {
    return;
  }
  const usedVariants = new Set(playerPistolVariants.values());
  playerPistolVariants.set(playerId, usedVariants.has(0) ? 1 : 0);
}

function assignJoinedPlayerRifleVariant(playerId) {
  if (playerRifleVariants.has(playerId)) {
    return;
  }
  const usedVariants = new Set(playerRifleVariants.values());
  playerRifleVariants.set(playerId, usedVariants.has(0) ? 1 : 0);
}

function resetForNextSeriesRound(data) {
  updateSeriesState(data.series);
  syncGrenadePickups(data.grenades);
  syncRiflePickups(data.rifles);
  syncPistolPickups(data.pistols);
  syncKnifePickups(data.knives);
  assignRifleVariants(data.players);
  assignPistolVariants(data.players);

  data.players.forEach((playerData) => {
    if (playerData.id !== localPlayerId && !players.has(playerData.id)) {
      addPlayer(playerData);
    }
    const player = players.get(playerData.id);
    if (!player) {
      return;
    }
    player.position.set(
      playerData.position.x,
      playerData.position.y || 0,
      playerData.position.z
    );
    player.rotation.y = playerData.yaw || 0;
    player.scale.set(1, 1, 1);
    player.visible = true;
    player.userData.health = playerData.health ?? 100;
    player.userData.weaponType = null;
    player.userData.weaponAmmo = 0;
    player.userData.hasKnife = false;
    player.userData.knifeEquipped = false;
    player.userData.aiming = false;
    player.userData.crouching = false;
    player.userData.deathAnimationScheduled = false;
    player.userData.rollStartedAt = 0;
    player.userData.soldierForcedUntil = 0;
    player.userData.characterPivot.rotation.set(0, 0, 0);
    player.userData.heldRifle.visible = false;
    player.userData.heldPistol.visible = false;
    player.userData.heldBazooka.visible = false;
    player.userData.heldKnife.visible = false;
    player.userData.heldKnife.rotation.set(0, 0, 0);
    player.userData.heldGrenade.visible = false;
    updatePlayerTarget(playerData);
    player.userData.lastAnimationPosition?.copy(player.position);
    setPlayerHealth(playerData.id, playerData.health ?? 100);

    if (player.userData.soldierActions) {
      const idleName = player.userData.soldierActions.has("Idle_Neutral")
        ? "Idle_Neutral"
        : "Idle";
      playSoldierAnimation(player, idleName, false);
    }
  });

  for (const projectile of projectiles) {
    scene.remove(projectile.mesh);
    if (projectile.mesh.isMesh && projectile.mesh.material !== projectileMaterial) {
      projectile.mesh.material.dispose();
    }
  }
  projectiles.length = 0;
  thrownGrenades.forEach(({ mesh }) => scene.remove(mesh));
  thrownGrenades.clear();

  const localData = data.players.find((player) => player.id === localPlayerId);
  if (localData && localPlayer) {
    cameraYaw = localData.yaw || 0;
    localPhaseSide = localData.position.z < 0 ? -1 : 1;
    verticalVelocity = 0;
    localPlayer.visible = true;
  }
  setKnifeInventory(false, false);
  setWeaponInventory(null, 0);
  setGrenadeCount(0);
  isFiring = false;
  isAiming = false;
  keys.clear();
  document.body.classList.remove("aiming");
  lastSentState = null;
  roundResultElement.hidden = true;
  endMenuActionsElement.hidden = true;
  restartMatchButton.hidden = false;
  updateRoundState(data.round);
  statusElement.textContent = seriesState.enabled
    ? `Partida ${seriesState.roundNumber}/${seriesState.maxRounds}. ¡A jugar!`
    : "Partida reiniciada. ¡A jugar!";
  if (restartRequestTimer !== null) {
    window.clearTimeout(restartRequestTimer);
    restartRequestTimer = null;
  }
}

function connectSocket(mode = "online", bestOfThree = false) {
  socket = io({ query: { mode, series: bestOfThree ? "bo3" : "single" } });
  const showReturnOnlyResult = (message) => {
    if (restartRequestTimer !== null) {
      window.clearTimeout(restartRequestTimer);
      restartRequestTimer = null;
    }
    roundEnded = true;
    isFiring = false;
    isAiming = false;
    isDraggingView = false;
    keys.clear();
    document.body.classList.remove("aiming");
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
    roundResultElement.hidden = false;
    roundResultTextElement.textContent = message;
    restartMatchButton.hidden = true;
    endMenuActionsElement.hidden = false;
  };

  socket.on("connect", () => {
    statusElement.textContent = "Conectado. Esperando la partida...";
  });

  socket.on("disconnect", () => {
    statusElement.textContent = "Desconectado del servidor.";
  });

  socket.on("game:full", () => {
    statusElement.textContent = "La partida ya tiene dos jugadores.";
  });

  socket.on("match:restart-rejected", () => {
    showReturnOnlyResult("NO HAY RIVAL PARA REINICIAR LA PARTIDA");
  });

  socket.on("match:closed", ({ reason } = {}) => {
    showReturnOnlyResult(reason || "LA PARTIDA SE CERRÓ");
  });

  socket.on("game:state", (state) => {
    localPlayerId = state.playerId;
    assignRifleVariants(state.players);
    assignPistolVariants(state.players);
    const localData = state.players.find((player) => player.id === localPlayerId);
    syncGrenadePickups(state.grenades);
    syncRiflePickups(state.rifles);
    syncPistolPickups(state.pistols);
    syncKnifePickups(state.knives);
    updateSeriesState(state.series);
    updateRoundState(state.round);

    if (localData) {
      if (!localPlayer) {
        localPlayer = createPlayer(localPlayerId, localData);
        cameraYaw = localData.yaw || 0;
        localPhaseSide = localData.position.z < 0 ? -1 : 1;
      }
      setGrenadeCount(localData.grenadeCount || 0);
      setWeaponInventory(localData.weaponType, localData.weaponAmmo || 0);
      setKnifeInventory(
        Boolean(localData.hasKnife),
        Boolean(localData.knifeEquipped)
      );
      setPlayerHealth(localPlayerId, localData.health ?? 100);
      statusElement.textContent = "Conectado. Esperando al segundo jugador...";
    }

    state.players.forEach(addPlayer);
    if (state.players.length === 2) {
      statusElement.textContent = "Partida lista. ¡A jugar!";
    }
  });

  socket.on("player:joined", (player) => {
    assignJoinedPlayerRifleVariant(player.id);
    assignJoinedPlayerPistolVariant(player.id);
    addPlayer(player);
    statusElement.textContent = "¡El segundo jugador se unió!";
  });

  socket.on("player:moved", (player) => {
    if (player.id !== localPlayerId) {
      updatePlayerTarget(player);
    }
  });

  socket.on("player:position", (position) => {
    if (!localPlayer || !position) {
      return;
    }
    localPlayer.position.set(position.x, position.y, position.z);
    lastSentState = null;
  });

  socket.on("player:eliminated", ({ id }) => {
    startPlayerDeathAnimation(players.get(id));
  });

  socket.on("player:shot", (shot) => {
    fireProjectile(
      shot.id,
      shot.position,
      shot.yaw,
      shot.crouching,
      shot.direction,
      shot.weaponType,
      Number.isFinite(shot.rockHitDistance) ? shot.rockHitDistance : Infinity
    );
    playShotSound(shot.weaponType, shot.position);
    const shooter = players.get(shot.id);
    if (shooter) {
      if (!shot.knifeEquipped) {
        const moving = (shooter.userData.animationSpeed || 0) >= 0.35;
        const preferredShotAnimation = moving ? "Run_Shoot" : "Idle_Gun_Shoot";
        const shotAnimation = shooter.userData.soldierActions?.has(preferredShotAnimation)
          ? preferredShotAnimation
          : "Gun_Shoot";
        playSoldierAnimation(shooter, shotAnimation);
      }
      shooter.userData.weaponType = shot.ammo > 0 ? shot.weaponType : null;
      shooter.userData.weaponAmmo = shot.ammo;
      shooter.userData.heldRifle.visible =
          !shot.knifeEquipped && shot.weaponType === "rifle" && shot.ammo > 0;
      shooter.userData.heldPistol.visible =
          !shot.knifeEquipped && shot.weaponType === "pistol" && shot.ammo > 0;
      shooter.userData.heldBazooka.visible =
          !shot.knifeEquipped && shot.weaponType === "bazooka" && shot.ammo > 0;
        shooter.userData.heldKnife.visible =
          Boolean(shooter.userData.hasKnife) && shot.knifeEquipped;
        shooter.userData.knifeEquipped = Boolean(shot.knifeEquipped);
    }
    if (shot.id === localPlayerId) {
      setWeaponInventory(shot.ammo > 0 ? shot.weaponType : null, shot.ammo);
    }
  });

  socket.on("round:state", updateRoundState);

  socket.on("series:round-started", resetForNextSeriesRound);
  socket.on("match:restarted", resetForNextSeriesRound);

  socket.on("round:ended", ({ winner, roundWinner = winner, series }) => {
    roundEnded = true;
    isFiring = false;
    roundResultElement.hidden = false;
    endMenuActionsElement.hidden = false;
    restartMatchButton.hidden = false;
    isAiming = false;
    isDraggingView = false;
    keys.clear();
    document.body.classList.remove("aiming");
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
    if (series?.enabled) {
      updateSeriesState(series);
      const scores = series.scores || {};
      const localWins = Number(scores[localPlayerId] || 0);
      const opponentWins = Number(
        Object.entries(scores).find(([id]) => id !== localPlayerId)?.[1] || 0
      );
      const scoreText = `MARCADOR ${localWins}-${opponentWins}`;
      if (series.complete) {
        roundResultTextElement.textContent =
          series.winner === null
            ? `SERIE EMPATADA\n${scoreText}`
            : series.winner === localPlayerId
              ? `¡SERIE GANADA!\n${scoreText}`
              : `SERIE PERDIDA\n${scoreText}`;
      } else {
        const roundResult =
          roundWinner === null
            ? "EMPATE EN ESTA PARTIDA"
            : roundWinner === localPlayerId
              ? "GANASTE ESTA PARTIDA"
              : "PERDISTE ESTA PARTIDA";
        roundResultTextElement.textContent =
          `PARTIDA ${series.roundNumber}/${series.maxRounds}\n${roundResult}\n${scoreText}\nSIGUIENTE PARTIDA EN UNOS SEGUNDOS`;
      }
    } else {
      roundResultTextElement.textContent =
        winner === null
          ? "EMPATE"
          : winner === localPlayerId
            ? "¡VICTORIA!"
            : "DERROTA";
    }
  });

  socket.on("player:health", ({ id, health, source }) => {
    const player = players.get(id);
    if (
      health < (player?.userData.health ?? health) &&
      source !== "zone" &&
      source !== "phase"
    ) {
      if (health > 0) {
        const actions = player?.userData.soldierActions;
        const hitAnimation = ["HitRecieve", "HitRecieve_2", "HitReceive", "HitReceive_2"]
          .find((name) => actions?.has(name));
        if (hitAnimation) playSoldierAnimation(player, hitAnimation);
      }
      playPainSound(
        player?.position,
        (player?.userData.health ?? health) - health
      );
      addBloodEffect(player);
      if (id === localPlayerId) {
        hitFlashUntil = performance.now() + 220;
        cameraShake = Math.max(cameraShake, 0.22);
      }
    }
    setPlayerHealth(id, health);
    if (id === localPlayerId && source === "zone") {
      statusElement.textContent = "¡Fuera de la zona segura!";
    }
    if (health <= 0) {
      startPlayerDeathAnimation(player);
      if (id === localPlayerId) {
        isFiring = false;
      }
    }
  });

  socket.on("grenade:inventory", ({ count }) => {
    setGrenadeCount(count);
  });

  socket.on("grenade:picked", ({ id, playerId }) => {
    removeGrenadePickup(id);
    playPickupSound();
    playSoldierAnimation(players.get(playerId), "Interact");
  });

  socket.on("grenade:thrown", (grenade) => {
    spawnThrownGrenade(grenade);
    playGrenadeThrowSound();
  });

  socket.on("grenade:exploded", ({ id, position }) => {
    playExplosionSound(position);
    detonateGrenade(id, position);
  });

  socket.on("weapon:picked", ({ id, playerId, type, ammo }) => {
    playWeaponEquipSound();
    playSoldierAnimation(players.get(playerId), "Interact");
    if (type === "rifle") {
      removeRiflePickup(id);
    } else if (type === "pistol") {
      removePistolPickup(id);
    } else if (type === "bazooka") {
      removeGrenadePickup(id);
    }
    const player = players.get(playerId);
    if (player) {
      if (type === "rifle") {
        setHeldWeaponVariant(player, type, rifleVariantForPickup(id));
      } else if (type === "pistol") {
        setHeldWeaponVariant(player, type, pistolVariantForPickup(id));
      }
      player.userData.knifeEquipped = false;
      player.userData.weaponType = type;
      player.userData.weaponAmmo = ammo || (type === "rifle" ? 30 : 12);
      player.userData.heldKnife.visible = false;
      player.userData.heldRifle.visible = type === "rifle";
      player.userData.heldPistol.visible = type === "pistol";
      player.userData.heldBazooka.visible = type === "bazooka";
      if (playerId === localPlayerId) {
        knifeEquipped = false;
        setWeaponInventory(weaponType, weaponAmmo);
      }
    }
  });

  socket.on("weapon:dropped", ({ id, position, type, ammo, playerId }) => {
    addDroppedWeapon({ id, position, type, ammo });
    const player = players.get(playerId);
    if (player) {
      player.userData.weaponType = null;
      player.userData.weaponAmmo = 0;
      player.userData.heldRifle.visible = false;
      player.userData.heldPistol.visible = false;
      player.userData.knifeEquipped = Boolean(player.userData.hasKnife);
      player.userData.heldKnife.visible = player.userData.knifeEquipped;
    }
    if (playerId === localPlayerId) {
      setWeaponInventory(null, 0);
    }
  });

  socket.on("weapon:inventory", ({ type, ammo }) => {
    setWeaponInventory(type, ammo);
  });

  socket.on("knife:picked", ({ id, playerId, knifeEquipped: equipped }) => {
    playPickupSound();
    playSoldierAnimation(players.get(playerId), "Interact");
    removeKnifePickup(id);
    const player = players.get(playerId);
    if (player) {
      player.userData.hasKnife = true;
      player.userData.knifeEquipped = Boolean(equipped);
      player.userData.heldKnife.visible = Boolean(equipped);
      if (equipped) {
        player.userData.heldPistol.visible = false;
        player.userData.heldRifle.visible = false;
      }
    }
    if (playerId === localPlayerId) {
      setKnifeInventory(true, Boolean(equipped));
    }
  });

  socket.on("weapon:selected", ({ id, knifeEquipped: equipped }) => {
    const player = players.get(id);
    if (player) {
      player.userData.knifeEquipped = equipped;
      player.userData.heldKnife.visible = player.userData.hasKnife && equipped;
      player.userData.heldRifle.visible =
        !equipped &&
        player.userData.weaponType === "rifle" &&
        player.userData.weaponAmmo > 0;
      player.userData.heldPistol.visible =
        !equipped &&
        player.userData.weaponType === "pistol" &&
        player.userData.weaponAmmo > 0;
    }
    if (id === localPlayerId) {
      knifeEquipped = equipped;
      setWeaponInventory(weaponType, weaponAmmo);
    }
  });

  socket.on("knife:swung", ({ id }) => {
    playKnifeSound();
    const player = players.get(id);
    if (player) {
      playSoldierAnimation(player, "Sword_Slash");
      player.userData.heldKnife.rotation.x = -0.7;
      window.setTimeout(() => {
        if (players.has(id)) {
          player.userData.heldKnife.rotation.x = 0;
        }
      }, 160);
    }
  });

  socket.on("player:left", ({ id }) => {
    removePlayer(id);
    if (localPlayerId !== null) {
      statusElement.textContent = "El otro jugador se desconectó.";
    }
  });
}

function startPlayerRoll() {
  if (
    !localPlayer ||
    roundEnded ||
    playerHealth <= 0 ||
    localPlayer.position.y > 0.05 ||
    localPlayer.userData.rollStartedAt > 0
  ) {
    return;
  }

  const sideInput = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const forwardInput = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const inputLength = Math.hypot(sideInput, forwardInput) || 1;
  const forward = forwardFromYaw(cameraYaw);
  localRight.set(1, 0, 0).applyAxisAngle(worldUp, cameraYaw);
  localPlayer.userData.rollDirection
    .set(
      localRight.x * sideInput + forward.x * forwardInput,
      0,
      localRight.z * sideInput + forward.z * forwardInput
    )
    .normalize();
  if (!sideInput && !forwardInput) {
    localPlayer.userData.rollDirection.copy(forward);
  }
  localPlayer.userData.rollStartedAt = performance.now();
}

window.addEventListener("keydown", (event) => {
  const code = event.code;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyF",
      "KeyE",
      "ShiftLeft",
      "ControlLeft",
      "Space",
      "AltLeft",
      "AltRight"
    ].includes(code)
  ) {
    event.preventDefault();
  }

  if (code === "KeyE" && !event.repeat) {
    pickUpNearbyItem();
  }
  if (code === "KeyF" && !event.repeat) {
    startPlayerRoll();
  }
  if (code === "KeyQ" && !event.repeat && weaponAmmo > 0) {
    socket?.emit("weapon:drop");
  }
  if (code === "KeyV" && !event.repeat && hasKnife && weaponAmmo > 0) {
    knifeEquipped = !knifeEquipped;
    setWeaponInventory(weaponType, weaponAmmo);
    socket?.emit("weapon:select", { knifeEquipped });
  }

  if (code === "Space" && !keys.has(code) && localPlayer) {
    const onGround = localPlayer.position.y <= 0.001;
    if (onGround && !keys.has("ControlLeft")) {
      verticalVelocity = jumpSpeed;
      playTone(155, 85, 0.16, 0.12, "triangle");
    }
  }
  keys.add(code);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

canvas.addEventListener("mousedown", (event) => {
  if (event.button === 0 || event.button === 2) {
    event.preventDefault();
  }
  isDraggingView = true;
  if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
    const lockRequest = canvas.requestPointerLock();
    if (lockRequest && typeof lockRequest.catch === "function") {
      lockRequest.catch(() => {
        statusElement.textContent = "Modo de mouse libre; arrastra para mirar.";
      });
    }
  }

  if (event.button === 2) {
    isAiming = true;
    document.body.classList.add("aiming");
  } else if (event.button === 0) {
    shoot();
  }
});

window.addEventListener("mouseup", (event) => {
  if (event.button === 2) {
    isAiming = false;
    document.body.classList.remove("aiming");
  }
  if (event.button === 0) {
    isFiring = false;
  }
  if (event.button === 0 || event.button === 2) {
    isDraggingView = false;
  }
});

window.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas && !isDraggingView) {
    return;
  }

  cameraYaw -= event.movementX * 0.0025;
  cameraPitch = THREE.MathUtils.clamp(
    cameraPitch - event.movementY * 0.002,
    -0.75,
    0.65
  );
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas) {
    isDraggingView = false;
    isAiming = false;
    isFiring = false;
    document.body.classList.remove("aiming");
  }
});
window.addEventListener("blur", () => {
  keys.clear();
  isAiming = false;
  isDraggingView = false;
  isFiring = false;
  document.body.classList.remove("aiming");
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const desiredCameraPosition = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();

function updateCamera(delta) {
  if (!localPlayer) {
    return;
  }

  const crouching = keys.has("ControlLeft");
  const frontView = keys.has("AltLeft") || keys.has("AltRight");
  const pivotHeight = crouching ? 1.05 : 1.45;
  const viewDirection = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch)
  );
  localRight.set(1, 0, 0).applyAxisAngle(worldUp, cameraYaw);
  cameraLookTarget
    .copy(localPlayer.position)
    .add(new THREE.Vector3(0, pivotHeight, 0));
  if (isAiming) {
    desiredCameraPosition
      .copy(cameraLookTarget)
      .addScaledVector(localRight, 0.08);
  } else {
    desiredCameraPosition
      .copy(cameraLookTarget)
      .addScaledVector(viewDirection, frontView ? 6.5 : -6.5)
      .addScaledVector(localRight, 0.55);
  }
  localPlayer.visible = !isAiming || playerHealth <= 0;
  localPlayer.userData.aiming = isAiming;
  camera.position.lerp(desiredCameraPosition, Math.min(1, delta * 8));
  camera.lookAt(cameraLookTarget.addScaledVector(viewDirection, frontView ? -20 : 20));
  if (cameraShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * cameraShake;
    camera.position.y += (Math.random() - 0.5) * cameraShake * 0.7;
    cameraShake = Math.max(0, cameraShake - delta * 4.5);
  }

  const targetFov = isAiming ? 24 : 50;
  camera.fov += (targetFov - camera.fov) * Math.min(1, delta * 7);
  camera.updateProjectionMatrix();
}

function canOccupyPosition(x, z) {
  const playerRadius = 0.62;
  return rockObstacles.every((rock) => {
    const minimumDistance = playerRadius + rock.radius;
    return (x - rock.x) ** 2 + (z - rock.z) ** 2 >= minimumDistance ** 2;
  });
}

function isPositionInPhaseZone(x, z, phase) {
  if (phase === 4) {
    return Math.hypot(x, z) <= centerSafeRadius;
  }
  const zoneIndex = phase - 1;
  const zoneLength = (fieldBounds.maxZ - fieldBounds.minZ) / 6;
  const minZ =
    localPhaseSide < 0
      ? fieldBounds.minZ + zoneLength * zoneIndex
      : fieldBounds.maxZ - zoneLength * (zoneIndex + 1);
  const insideLane = z >= minZ && z <= minZ + zoneLength;
  return (
    insideLane &&
    (phase !== 3 || Math.hypot(x, z) > centerSafeRadius)
  );
}

function constrainPositionToPhase(x, z) {
  const constrained = {
    x: THREE.MathUtils.clamp(x, fieldBounds.minX, fieldBounds.maxX),
    z: THREE.MathUtils.clamp(z, fieldBounds.minZ, fieldBounds.maxZ)
  };
  if (roundPhase === 4) {
    const distance = Math.hypot(constrained.x, constrained.z);
    if (distance > centerSafeRadius) {
      const scale = centerSafeRadius / distance;
      constrained.x *= scale;
      constrained.z *= scale;
    }
    return constrained;
  }

  if (roundPhase > 0 && isPositionInPhaseZone(constrained.x, constrained.z, roundPhase)) {
    return constrained;
  }
  if (escapeOpen && roundPhase < 3 && isPositionInPhaseZone(constrained.x, constrained.z, roundPhase + 1)) {
    return constrained;
  }
  if (escapeOpen && roundPhase === 3 && isPositionInPhaseZone(constrained.x, constrained.z, 4)) {
    return constrained;
  }
  if (roundPhase > 0) {
    const zoneLength = (fieldBounds.maxZ - fieldBounds.minZ) / 6;
    const zoneIndex = roundPhase - 1;
    const minZ = localPhaseSide < 0
      ? fieldBounds.minZ + zoneLength * zoneIndex
      : fieldBounds.maxZ - zoneLength * (zoneIndex + 1);
    constrained.z = THREE.MathUtils.clamp(constrained.z, minZ, minZ + zoneLength);
    if (
      roundPhase === 3 &&
      Math.hypot(constrained.x, constrained.z) <= centerSafeRadius
    ) {
      const safeOffset = Math.sqrt(
        Math.max(0, centerSafeRadius ** 2 - constrained.x ** 2)
      );
      constrained.z = THREE.MathUtils.clamp(
        localPhaseSide < 0 ? -safeOffset - 0.1 : safeOffset + 0.1,
        minZ,
        minZ + zoneLength
      );
    }
  }
  return constrained;
}

function resolvePlayerRockOverlaps() {
  if (!localPlayer) {
    return;
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const rock of rockObstacles) {
      const minimumDistance = 0.62 + rock.radius;
      const dx = localPlayer.position.x - rock.x;
      const dz = localPlayer.position.z - rock.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= minimumDistance) {
        continue;
      }
      const directionX = distance > 0.001 ? dx / distance : 1;
      const directionZ = distance > 0.001 ? dz / distance : 0;
      localPlayer.position.x = THREE.MathUtils.clamp(
        rock.x + directionX * minimumDistance,
        fieldBounds.minX,
        fieldBounds.maxX
      );
      localPlayer.position.z = THREE.MathUtils.clamp(
        rock.z + directionZ * minimumDistance,
        fieldBounds.minZ,
        fieldBounds.maxZ
      );
    }
  }
}

function updateMovement(delta, now) {
  if (!localPlayer || roundEnded || playerHealth <= 0) {
    return;
  }

  const crouching = keys.has("ControlLeft");
  const inputX = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const inputZ = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
  const inputLength = Math.hypot(inputX, inputZ);
  const rolling = localPlayer.userData.rollStartedAt > 0;
  footstepCooldown -= delta;
  if (!rolling && inputLength > 0 && localPlayer.position.y <= 0.05 && footstepCooldown <= 0) {
    playFootstepSound();
    footstepCooldown = crouching ? 0.68 : keys.has("ShiftLeft") ? 0.32 : 0.48;
    spawnDust(localPlayer.position.clone(), keys.has("ShiftLeft") ? 6 : 3);
  }

  localPlayer.rotation.y = cameraYaw;
  if (inputLength > 0 && !rolling) {
    const forward = forwardFromYaw(cameraYaw);
    localRight.set(1, 0, 0).applyAxisAngle(worldUp, cameraYaw);
    const rightInput = inputX / inputLength;
    const forwardInput = -inputZ / inputLength;
    const moveX = localRight.x * rightInput + forward.x * forwardInput;
    const moveZ = localRight.z * rightInput + forward.z * forwardInput;

    const speed = crouching
      ? crouchSpeed
      : keys.has("ShiftLeft")
        ? sprintSpeed
        : moveSpeed;
    const boundedX = constrainPositionToPhase(
      localPlayer.position.x + moveX * speed * delta,
      localPlayer.position.z
    );
    const nextX = boundedX.x;
    if (canOccupyPosition(nextX, localPlayer.position.z)) {
      localPlayer.position.x = nextX;
    }
    const boundedZ = constrainPositionToPhase(
      localPlayer.position.x,
      localPlayer.position.z + moveZ * speed * delta
    );
    const nextZ = boundedZ.z;
    if (canOccupyPosition(localPlayer.position.x, nextZ)) {
      localPlayer.position.z = nextZ;
    }
  }

  if (rolling) {
    const elapsed = now - localPlayer.userData.rollStartedAt;
    const progress = Math.min(1, elapsed / rollDuration);
    const stepDistance = rollDistance * (delta * 1000 / rollDuration);
    const direction = localPlayer.userData.rollDirection;
    const nextX = constrainPositionToPhase(
      localPlayer.position.x + direction.x * stepDistance,
      localPlayer.position.z
    ).x;
    if (canOccupyPosition(nextX, localPlayer.position.z)) {
      localPlayer.position.x = nextX;
    }
    const nextZ = constrainPositionToPhase(
      localPlayer.position.x,
      localPlayer.position.z + direction.z * stepDistance
    ).z;
    if (canOccupyPosition(localPlayer.position.x, nextZ)) {
      localPlayer.position.z = nextZ;
    }
    localPlayer.userData.characterPivot.rotation.x = Math.PI * 2 * progress;
    if (progress >= 1) {
      localPlayer.userData.rollStartedAt = 0;
      localPlayer.userData.characterPivot.rotation.x = 0;
      lastSentState = null;
    }
  }

  if (localPlayer.position.y > 0 || verticalVelocity > 0) {
    verticalVelocity -= gravity * delta;
    localPlayer.position.y = Math.max(
      0,
      localPlayer.position.y + verticalVelocity * delta
    );
    if (localPlayer.position.y === 0) {
      if (verticalVelocity < -6) {
        spawnDust(localPlayer.position.clone(), 8);
        cameraShake = Math.max(cameraShake, 0.08);
      }
      verticalVelocity = 0;
    }
  }

  const targetScaleY = crouching ? 0.75 : 1;
  localPlayer.scale.y += (targetScaleY - localPlayer.scale.y) * Math.min(1, delta * 14);
  sendPlayerState(now);
}

function updateRemotePlayers(delta) {
  playerTargets.forEach((target, id) => {
    if (id === localPlayerId) {
      return;
    }

    const root = players.get(id);
    if (!root) {
      return;
    }
    // El servidor es la fuente de vida del jugador; evita que un estado
    // visual de eliminación deje oculto a un rival que sigue activo.
    root.visible = root.userData.health > 0;
    root.position.lerp(target.position, Math.min(1, delta * 12));
    const yawDifference = Math.atan2(
      Math.sin(target.yaw - root.rotation.y),
      Math.cos(target.yaw - root.rotation.y)
    );
    root.rotation.y += yawDifference * Math.min(1, delta * 12);
    const targetScaleY = target.crouching ? 0.75 : 1;
    root.scale.y += (targetScaleY - root.scale.y) * Math.min(1, delta * 12);
    root.userData.crouching = target.crouching;
    root.userData.aiming = target.aiming;
    if (target.rolling && root.userData.rollStartedAt > 0) {
      const progress = Math.min(
        1,
        (performance.now() - root.userData.rollStartedAt) / rollDuration
      );
      root.userData.characterPivot.rotation.x = Math.PI * 2 * progress;
    }
  });
}

function updateProjectiles(delta) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    const previousPosition = projectile.mesh.position.clone();
    const projectileSpeed = projectile.velocity.length();
    const requestedDistance = projectileSpeed * delta;
    const remainingDistance = Math.max(0, projectile.maxDistance - projectile.travelled);
    const stepDistance = Math.min(requestedDistance, remainingDistance);
    projectile.mesh.position.addScaledVector(
      projectile.velocity,
      projectileSpeed > 0 ? stepDistance / projectileSpeed : 0
    );
    projectile.travelled += stepDistance;
    projectile.lifetime -= delta;
    projectile.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      projectile.velocity.clone().normalize()
    );

    const hitGround = projectile.mesh.position.y <= 0.04;
    const segment = projectile.mesh.position.clone().sub(previousPosition);
    const segmentLength = segment.length();
    const segmentDirection = segmentLength > 0
      ? segment.multiplyScalar(1 / segmentLength)
      : null;
    const serverForcedImpact = Number.isFinite(projectile.maxDistance) &&
      projectile.travelled >= projectile.maxDistance - 1e-4;
    const hitRock = serverForcedImpact || (segmentLength > 0 && rockObstacles.some((rock) =>
      projectileHitsRockBox(
        previousPosition,
        segmentDirection,
        segmentLength,
        rock
      )
    ));
    const hitWall = Math.abs(projectile.mesh.position.x) >= halfWidth || Math.abs(projectile.mesh.position.z) >= halfLength;
    const outOfBounds =
      projectile.lifetime <= 0 ||
      Math.abs(projectile.mesh.position.x) > halfWidth + 2 ||
      Math.abs(projectile.mesh.position.z) > halfLength + 2 ||
      hitGround || hitRock || hitWall;

    if (outOfBounds) {
      if (hitGround || hitRock || hitWall) {
        spawnImpactSparks(projectile.mesh.position, projectile.velocity.clone().normalize());
        spawnDust(projectile.mesh.position, 3);
        if (projectile.weaponType === "bazooka") {
          const blast = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 10),
            new THREE.MeshBasicMaterial({ color: 0xff8a32, transparent: true, opacity: 0.82, depthWrite: false })
          );
          blast.position.copy(projectile.mesh.position);
          blast.scale.setScalar(0.25);
          scene.add(blast);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.2, 0.4, 20),
            new THREE.MeshBasicMaterial({ color: 0xffd16a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(projectile.mesh.position.x, 0.06, projectile.mesh.position.z);
          scene.add(ring);
          grenadeExplosions.push({ mesh: blast, shockwave: ring, age: 0 });
          spawnFxLight(projectile.mesh.position, 0xff7028, 9, 16, 0.22);
          playExplosionSound(projectile.mesh.position);
        }
      }
      scene.remove(projectile.mesh);
      // Bazooka projectiles are Groups with shared child materials. Only
      // dispose the per-shot material used by ordinary Mesh projectiles.
      if (projectile.mesh.isMesh && projectile.mesh.material !== projectileMaterial) {
        projectile.mesh.material.dispose();
      }
      projectiles.splice(i, 1);
    }
  }
}

function updateMovingRocks(delta) {
  const transform = new THREE.Object3D();
  movingRocks.forEach((rock) => {
    rock.x += rock.velocityX * delta;
    rock.z += rock.velocityZ * delta;

    if (rock.x < rock.minX || rock.x > rock.maxX) {
      rock.x = THREE.MathUtils.clamp(rock.x, rock.minX, rock.maxX);
      rock.velocityX *= -1;
    }
    if (rock.z < rock.minZ || rock.z > rock.maxZ) {
      rock.z = THREE.MathUtils.clamp(rock.z, rock.minZ, rock.maxZ);
      rock.velocityZ *= -1;
    }

    rock.rotationY += delta * 0.12;
  });

  if (roundStartedAt !== null) {
    const elapsed = Math.max(0, Date.now() - roundStartedAt);
    const teleportStep = Math.floor(elapsed / 4500);
    while (lastTeleportStep < teleportStep) {
      lastTeleportStep += 1;
      for (let move = 0; move < 2 && teleportingRocks.length > 0; move += 1) {
        const rock =
          teleportingRocks[
            Math.floor(teleportRng() * teleportingRocks.length)
          ];
        let attempts = 0;
        let x;
        let z;
        do {
          x = rock.minX + teleportRng() * (rock.maxX - rock.minX);
          z = rock.minZ + teleportRng() * (rock.maxZ - rock.minZ);
          attempts += 1;
        } while (
          attempts < 40 &&
          Math.hypot(x, z) < centerSafeRadius + rock.radius + 1
        );
        rock.x = x;
        rock.z = z;
      }
    }
  }

  movingRocks.concat(teleportingRocks).forEach((rock) => {
    transform.position.set(rock.x, rock.y, rock.z);
    transform.rotation.set(
      rock.rotationX,
      rock.rotationY,
      rock.rotationZ
    );
    transform.scale.set(rock.scaleX, rock.scaleY, rock.scaleZ);
    transform.updateMatrix();
    arenaRocks.setMatrixAt(rock.index, transform.matrix);
  });
  if (movingRocks.length > 0) {
    arenaRocks.instanceMatrix.needsUpdate = true;
  } else if (teleportingRocks.length > 0) {
    arenaRocks.instanceMatrix.needsUpdate = true;
  }
}

function updateGrenades(delta, now) {
  grenadePickups.forEach((grenade) => {
    grenade.rotation.y += delta * 0.75;
    grenade.position.y = Math.sin(now * 0.002 + grenade.position.x) * 0.08;
  });

  const nearbyPickup = findNearbyPickup();
  grenadePickupPrompt.hidden = !nearbyPickup;
  if (nearbyPickup) {
    const promptLabels = {
    bazooka: "RECOGER BAZOOKA",
      rifle: "RECOGER RIFLE (30)",
      pistol: "RECOGER PISTOLA (12)",
      knife: "RECOGER MACHETE"
    };
    grenadePickupPrompt.innerHTML = `E ${promptLabels[nearbyPickup.kind]}`;
  }

  thrownGrenades.forEach((grenade, id) => {
    if (now >= grenade.detonateAt) {
      detonateGrenade(id);
      return;
    }
    if (grenade.resting) {
      return;
    }

    grenade.velocity.y -= 9.8 * delta;
    grenade.mesh.position.addScaledVector(grenade.velocity, delta);
    if (grenade.mesh.position.y <= 0.38) {
      grenade.mesh.position.y = 0.38;
      grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.38;
      grenade.velocity.x *= 0.72;
      grenade.velocity.z *= 0.72;
      if (grenade.velocity.y < 1.5) {
        grenade.velocity.set(0, 0, 0);
        grenade.resting = true;
      }
    }
    grenade.mesh.rotation.x += delta * 2;
    grenade.mesh.rotation.z += delta * 1.5;
  });

  for (let i = grenadeExplosions.length - 1; i >= 0; i -= 1) {
    const explosion = grenadeExplosions[i];
    explosion.age += delta;
    explosion.mesh.scale.setScalar(0.2 + explosion.age * 14);
    explosion.mesh.material.opacity = Math.max(0, 0.95 * (1 - explosion.age / 0.42));
    if (explosion.shockwave) {
      const wave = 0.4 + explosion.age * 18;
      explosion.shockwave.scale.set(wave, wave, 1);
      explosion.shockwave.material.opacity = Math.max(0, 0.8 * (1 - explosion.age / 0.5));
    }
    if (explosion.age >= 0.5) {
      scene.remove(explosion.mesh);
      explosion.mesh.geometry.dispose();
      explosion.mesh.material.dispose();
      if (explosion.shockwave) {
        scene.remove(explosion.shockwave);
        explosion.shockwave.geometry.dispose();
        explosion.shockwave.material.dispose();
      }
      grenadeExplosions.splice(i, 1);
    }
  }
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  updateMovingRocks(delta);
  if (socket?.connected && now - lastRockSyncAt >= 200) {
    lastRockSyncAt = now;
    socket.emit("arena:rocks", rockObstacles.map((rock) => {
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rock.rotationX, rock.rotationY, rock.rotationZ)
      );
      return {
        x: rock.x,
        y: rock.y,
        z: rock.z,
        qx: quaternion.x,
        qy: quaternion.y,
        qz: quaternion.z,
        qw: quaternion.w,
        halfX: rock.colliderHalfExtents.x,
        halfY: rock.colliderHalfExtents.y,
        halfZ: rock.colliderHalfExtents.z
      };
    }));
  }
  resolvePlayerRockOverlaps();
  updateMovement(delta, now);
  updateCamera(delta);
  updateRemotePlayers(delta);
  updatePlayerAnimations(delta);
  updateProjectiles(delta);
  updateBloodParticles(delta);
  updateVisualEffects(delta);
  updateGrenades(delta, now);
  updatePickupBeacons(now);
  updateZoneWarning(now);
  fireAutomaticShot(now);
  renderer.render(scene, camera);
}

const mainMenu = document.querySelector("#main-menu");
const playButton = document.querySelector("#play-button");
const trainingButton = document.querySelector("#training-button");
const aiTrainingButton = document.querySelector("#ai-training-button");
const gameUI = document.querySelector("#game-ui");
let gameStarted = false;
let animationFrameId = null;
let restartRequestTimer = null;

soundToggle.addEventListener("click", () => {
  audioMuted = !audioMuted;
  soundToggle.textContent = audioMuted ? "SONIDO: OFF" : "SONIDO: ON";
  soundToggle.setAttribute(
    "aria-label",
    audioMuted ? "Activar sonido" : "Silenciar sonido"
  );
  if (!audioMuted && audioContext) {
    audioContext.resume().catch(() => {
      statusElement.textContent = "El audio no pudo iniciarse en este navegador.";
    });
  }
});

function startGame(mode, bestOfThree = false) {
  if (gameStarted) {
    return;
  }
  gameStarted = true;
  initializeAudio();

  document.body.classList.add("game-started");
  gameUI.setAttribute("aria-hidden", "false");
  mainMenu.classList.add("is-closing");
  connectSocket(mode, bestOfThree);
  if (animationFrameId === null) {
    animate();
  }

  if (canvas.requestPointerLock) {
    try {
      const lockRequest = canvas.requestPointerLock();
      if (lockRequest && typeof lockRequest.catch === "function") {
        lockRequest.catch(() => {
          statusElement.textContent =
            "Partida lista. Haz clic en la arena para capturar el cursor.";
        });
      }
    } catch {
      statusElement.textContent =
        "Partida lista. Haz clic en la arena para capturar el cursor.";
    }
  }

  requestAnimationFrame(() => {
    gameUI.classList.add("is-visible");
  });
}

function returnToMainMenu() {
  if (restartRequestTimer !== null) {
    window.clearTimeout(restartRequestTimer);
    restartRequestTimer = null;
  }
  if (document.pointerLockElement && document.exitPointerLock) {
    document.exitPointerLock();
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  for (const id of [...players.keys()]) {
    removePlayer(id);
  }
  for (const projectile of projectiles) {
    scene.remove(projectile.mesh);
    if (projectile.mesh.isMesh && projectile.mesh.material !== projectileMaterial) {
      projectile.mesh.material.dispose();
    }
  }
  projectiles.length = 0;
  thrownGrenades.forEach(({ mesh }) => scene.remove(mesh));
  thrownGrenades.clear();
  playerRifleVariants.clear();
  playerPistolVariants.clear();
  localPlayer = null;
  localPlayerId = null;
  playerTargets.clear();
  seriesState = { enabled: false, roundNumber: 1, maxRounds: 3, scores: {} };
  roundStartedAt = null;
  roundPhase = 0;
  roundEnded = false;
  isAiming = false;
  isDraggingView = false;
  isFiring = false;
  keys.clear();
  document.body.classList.remove("game-started", "aiming", "low-health");
  gameUI.classList.remove("is-visible");
  gameUI.setAttribute("aria-hidden", "true");
  roundResultElement.hidden = true;
  endMenuActionsElement.hidden = true;
  restartMatchButton.hidden = false;
  mainMenu.hidden = false;
  mainMenu.classList.remove("is-closing");
  gameStarted = false;
}

restartMatchButton.addEventListener("click", () => {
  if (!socket?.connected) {
    returnToMainMenu();
    return;
  }
  endMenuActionsElement.hidden = true;
  roundResultTextElement.textContent = "REINICIANDO PARTIDA...";
  restartRequestTimer = window.setTimeout(() => {
    restartRequestTimer = null;
    roundResultTextElement.textContent =
      "NO SE PUDO CONFIRMAR EL REINICIO. INTENTÁ OTRA VEZ.";
    restartMatchButton.hidden = false;
    endMenuActionsElement.hidden = false;
  }, 5000);
  socket.emit("match:restart", (result) => {
    if (result?.ok === false) {
      showReturnOnlyResult(
        result.message || "NO SE PUDO REINICIAR LA PARTIDA"
      );
    }
  });
});

returnMenuButton.addEventListener("click", returnToMainMenu);

playButton.addEventListener("click", () => startGame("online", true));
trainingButton.addEventListener("click", () => startGame("online"));
aiTrainingButton.addEventListener("click", () => startGame("ai"));

mainMenu.addEventListener("transitionend", (event) => {
  if (
    event.target === mainMenu &&
    event.propertyName === "opacity" &&
    mainMenu.classList.contains("is-closing")
  ) {
    mainMenu.hidden = true;
  }
});
