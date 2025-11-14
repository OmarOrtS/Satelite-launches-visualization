import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import * as XLSX from "xlsx";

let scene, renderer;
let camera;
let camcontrols1;
let objetos = [];
let geocodeCache = new Map();

init();
animationLoop();

async function init() {
  // Escena y cámara
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  camcontrols1 = new OrbitControls(camera, renderer.domElement);

  // Luces
  const Lamb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(Lamb);

  const Ldir = new THREE.DirectionalLight(0xffffff, 1);
  Ldir.position.set(5, 5, 5);
  Ldir.castShadow = true;
  scene.add(Ldir);

  // Fondo estelar
  const sky = createSkySphere("milkyway.png");

  // Tierra
  const tx1 = new THREE.TextureLoader().load("earthmap1k.jpg");
  const txb1 = new THREE.TextureLoader().load("earthbump1k.jpg");
  const txspec1 = new THREE.TextureLoader().load("earthspec1k.jpg");
  const txcloud = new THREE.TextureLoader().load("earthcloudmap.jpg");
  const txalpha2 = new THREE.TextureLoader().load(
    "earthcloudmaptrans_invert.jpg"
  );

  Esfera(scene, 0, 0, 0, 2, 40, 40, 0xffffff, tx1, txb1, txspec1);
  Esfera(
    objetos[0],
    0,
    0,
    0,
    2.1,
    40,
    40,
    0xffffff,
    txcloud,
    undefined,
    undefined,
    txalpha2
  );

  // Leer dataset y lanzar animación
  const file = await fetch("UCS-Satellite-Database-5-1-2023.xlsx").then((r) =>
    r.blob()
  );
  const satelites = await leerDataset(file);
  reproducirTimelapse(satelites, 2);
}

function Esfera(
  padre,
  px,
  py,
  pz,
  radio,
  nx,
  ny,
  col,
  texture = undefined,
  texbump = undefined,
  texspec = undefined,
  texalpha = undefined,
  sombra = false
) {
  let geometry = new THREE.SphereGeometry(radio, nx, ny);
  let material = new THREE.MeshPhongMaterial({ color: col });

  if (texture) material.map = texture;
  if (texbump) {
    material.bumpMap = texbump;
    material.bumpScale = 0.1;
  }
  if (texspec) {
    material.specularMap = texspec;
    material.specular = new THREE.Color("orange");
  }
  if (texalpha) {
    material.alphaMap = texalpha;
    material.transparent = true;
    material.opacity = 0.9;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(px, py, pz);
  if (sombra) mesh.castShadow = true;
  padre.add(mesh);
  objetos.push(mesh);
}

function createSkySphere(texturePath) {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(texturePath);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.SphereGeometry(500, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const sky = new THREE.Mesh(geometry, material);
  scene.add(sky);
  return sky;
}

// === LECTURA DE XLSX ===
async function leerDataset(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  // Solo campos necesarios
  return rows
    .filter((r) => r["Launch Site"] && r["Date of Launch"])
    .map((r) => ({
      name: r["Name of Satellite"],
      launchSite: r["Launch Site"],
      launchDate: r["Date of Launch"],
      owner: r["Country of Operator/Owner"],
      orbitClass: r["Class of Orbit"],
      orbitType: r["Type of Orbit"],
      perigee: parseFloat(r["Perigee (km)"]) || 300,
      apogee: parseFloat(r["Apogee (km)"]) || 400,
      inclination:
        ((parseFloat(r["Inclination (degrees)"]) || 0) * Math.PI) / 180,
      period: parseFloat(r["Period (minutes)"]) || 100,
    }));
}

// === GEOCODIFICACIÓN (CON CACHÉ) ===
async function geocodeLugar(nombre) {
  if (geocodeCache.has(nombre)) return geocodeCache.get(nombre);

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    nombre
  )}`;
  const response = await fetch(url);
  const data = await response.json();
  const coords = data.length
    ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
    : null;

  geocodeCache.set(nombre, coords);
  return coords;
}

// === CONVERSIÓN LAT/LON → VECTOR 3D ===
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

// === COLOR SEGÚN PAÍS ===
function getColorByCountry(country) {
  if (!country) return 0xffffff;
  const key = country.toLowerCase();
  if (key.includes("usa")) return 0x00aaff;
  if (key.includes("china")) return 0xff3300;
  if (key.includes("russia")) return 0x8888ff;
  if (key.includes("europe")) return 0xffff00;
  if (key.includes("india")) return 0xff9900;
  return 0xffffff;
}

// === LANZAMIENTO ANIMADO ===
function lanzarSatelite(
  lat,
  lon,
  radio,
  color = 0x00ffff,
  perigee,
  apogee,
  inclination,
  period
) {
  const start = latLonToVector3(lat, lon, radio);
  const end = latLonToVector3(lat, lon, radio * 1.4);
  const geom = new THREE.SphereGeometry(0.1, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color });
  const sat = new THREE.Mesh(geom, mat);
  sat.position.copy(start);
  objetos[0].add(sat);

  let progress = 0;
  function animate() {
    if (progress < 1) {
      progress += 0.01;
      sat.position.lerpVectors(start, end, progress);
      requestAnimationFrame(animate);
    } else {
      objetos[0].remove(sat);
      scene.add(sat);
      const avgAltitude = (perigee + apogee) / 2;
      const earthRadiusKm = 6371;
      const orbitRadius =
        ((earthRadiusKm + avgAltitude) / earthRadiusKm) * radio;
      sat.userData.orbit = {
        radius: orbitRadius,
        inclination,
        angle: Math.random() * Math.PI * 2,
        speed: (2 * Math.PI) / ((period * 60) / 10),
      };
    }
  }
  animate();
}

// === TIMELAPSE ===
async function reproducirTimelapse(satelites, radio) {
  satelites.sort((a, b) => new Date(a.launchDate) - new Date(b.launchDate));

  for (const sat of satelites) {
    const coords = await geocodeLugar(sat.launchSite);
    if (!coords) continue;
    lanzarSatelite(
      coords.lat,
      coords.lon,
      radio,
      getColorByCountry(sat.owner),
      sat.perigee,
      sat.apogee,
      sat.inclination,
      sat.period
    );
    await new Promise((r) => setTimeout(r, 300));
  }
}

// === ANIMACIÓN PRINCIPAL ===
function animationLoop() {
  requestAnimationFrame(animationLoop);
  for (let object of objetos) {
    object.rotation.y += 0.001;
  }

  scene.traverse((obj) => {
    if (obj.userData.orbit) {
      obj.userData.orbit.angle += obj.userData.orbit.speed;
      const { radius, angle } = obj.userData.orbit;
      obj.position.x = radius * Math.cos(angle);
      obj.position.z = radius * Math.sin(angle);
    }
  });

  renderer.render(scene, camera);
}
