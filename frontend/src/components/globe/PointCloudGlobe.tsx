import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSocket } from '../../services/socket.js';

export interface GlobeMarker {
  id: string;
  label: string;
  online: boolean;
}

interface PointCloudGlobeProps {
  markers: GlobeMarker[];
  className?: string;
}

const RADIUS = 2.4;
const POINT_COUNT = 3200;
const ARC_POOL_CAP = 6;

/** Deterministic pseudo-random unit float from a string, so a given worker
 * id always lands on the same point on the sphere across re-renders. */
function hashToUnit(str: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return (Math.abs(h) % 10000) / 10000;
}

function markerPosition(id: string, radius: number): THREE.Vector3 {
  const u = hashToUnit(id, 17);
  const v = hashToUnit(id, 91);
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/** Fibonacci-lattice sphere sampling — evenly spaced, no pole clustering. */
function buildSpherePoints(radius: number, count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    positions[i * 3] = Math.cos(theta) * radiusAtY * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * radiusAtY * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

interface ActiveArc {
  // Rendered as a THREE.Points trail rather than a THREE.Line: WebGL widely
  // ignores requested line widths (forces ~1px regardless), which makes a
  // Line-based arc nearly invisible against the point-cloud background.
  // Points respect `size`/sizeAttenuation, so this reads clearly instead.
  points: THREE.Points;
  material: THREE.PointsMaterial;
  birth: number;
  totalPoints: number;
}

interface MarkerEntry {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  online: boolean;
}

/**
 * Abstract point-cloud globe: a Fibonacci-sphere of ~3k points, glowing
 * markers for live worker nodes, and animated arcs representing jobs moving
 * through the fleet - triggered by real `job:created`/`job:updated` socket
 * events, with a slow idle fallback so the hero isn't static before anyone
 * has submitted a job. Drag to rotate (with inertia), auto-rotates when
 * idle, pauses its render loop entirely when scrolled out of view.
 */
export const PointCloudGlobe: React.FC<PointCloudGlobeProps> = ({ markers, className = '' }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const groupRef = useRef<THREE.Group | null>(null);
  const markerMeshesRef = useRef<Map<string, MarkerEntry>>(new Map());
  const arcsRef = useRef<ActiveArc[]>([]);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(true);

  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastInteractionRef = useRef(0);
  const lastArcTimeRef = useRef(0);

  const spawnArcRef = useRef<((fromId: string, toId: string) => void) | null>(null);
  const markersRef = useRef<GlobeMarker[]>(markers);
  markersRef.current = markers;

  // ─── One-time scene setup ───────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 100);
    camera.position.set(0, 0, 6.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const sphereGeometry = buildSpherePoints(RADIUS, POINT_COUNT);
    const sphereMaterial = new THREE.PointsMaterial({
      size: 0.018,
      color: new THREE.Color('#ffffff'),
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true
    });
    const points = new THREE.Points(sphereGeometry, sphereMaterial);
    group.add(points);

    const wireGeometry = new THREE.SphereGeometry(RADIUS, 24, 16);
    const wireMaterial = new THREE.MeshBasicMaterial({ color: '#e4007c', wireframe: true, transparent: true, opacity: 0.04 });
    const wireMesh = new THREE.Mesh(wireGeometry, wireMaterial);
    group.add(wireMesh);

    // ── Pointer drag-to-rotate with inertia ──
    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      lastInteractionRef.current = performance.now();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const vx = dx * 0.005;
      const vy = dy * 0.005;
      group.rotation.y += vx;
      group.rotation.x += vy;
      velocityRef.current = { x: vx, y: vy };
      lastInteractionRef.current = performance.now();
    };
    const onPointerUp = () => {
      draggingRef.current = false;
      lastInteractionRef.current = performance.now();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ── Resize ──
    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    });
    resizeObserver.observe(container);

    // ── Pause render loop when off-screen or tab hidden ──
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        runningRef.current = entry.isIntersecting && !document.hidden;
        if (runningRef.current && frameRef.current === null) {
          frameRef.current = requestAnimationFrame(animate);
        }
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(container);

    const onVisibilityChange = () => {
      const inView = intersectionObserver.takeRecords()[0]?.isIntersecting ?? runningRef.current;
      runningRef.current = !document.hidden && inView;
      if (runningRef.current && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── Arc spawning ──
    spawnArcRef.current = (fromId, toId) => {
      const from = markerMeshesRef.current.get(fromId)?.position;
      const to = markerMeshesRef.current.get(toId)?.position;
      if (!from || !to) return;

      const mid = from.clone().add(to).multiplyScalar(0.5);
      mid.setLength(RADIUS * 1.55);
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const curvePoints = curve.getPoints(64);
      const positions = new Float32Array(curvePoints.length * 3);
      curvePoints.forEach((p, i) => {
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setDrawRange(0, 0);
      const material = new THREE.PointsMaterial({
        color: '#ff4fb0',
        size: 0.05,
        transparent: true,
        opacity: 1,
        sizeAttenuation: true,
        depthWrite: false
      });
      const points = new THREE.Points(geometry, material);
      group.add(points);
      arcsRef.current.push({ points, material, birth: performance.now(), totalPoints: curvePoints.length });

      if (arcsRef.current.length > ARC_POOL_CAP) {
        const stale = arcsRef.current.shift();
        if (stale) {
          group.remove(stale.points);
          stale.points.geometry.dispose();
          stale.material.dispose();
        }
      }
    };

    const tmpWorldPos = new THREE.Vector3();
    const tmpNormal = new THREE.Vector3();
    const tmpToCamera = new THREE.Vector3();

    function animate() {
      frameRef.current = requestAnimationFrame(animate);
      if (!runningRef.current) return;

      const now = performance.now();
      const idleFor = now - lastInteractionRef.current;

      if (!draggingRef.current) {
        if (idleFor < 600 && (Math.abs(velocityRef.current.x) > 0.0001 || Math.abs(velocityRef.current.y) > 0.0001)) {
          group.rotation.y += velocityRef.current.x;
          group.rotation.x += velocityRef.current.y;
          velocityRef.current.x *= 0.94;
          velocityRef.current.y *= 0.94;
        } else {
          group.rotation.y += 0.0009;
        }
      }

      markerMeshesRef.current.forEach(({ mesh, online }) => {
        const s = 1 + Math.sin(now / 500 + mesh.id) * (online ? 0.18 : 0.05);
        mesh.scale.setScalar(s);
      });

      const stillAlive: ActiveArc[] = [];
      const growMs = 700;
      const holdMs = 500;
      const fadeMs = 500;
      for (const arc of arcsRef.current) {
        const age = now - arc.birth;
        if (age < growMs) {
          arc.points.geometry.setDrawRange(0, Math.floor((age / growMs) * arc.totalPoints));
          arc.material.opacity = 1;
          stillAlive.push(arc);
        } else if (age < growMs + holdMs) {
          arc.points.geometry.setDrawRange(0, arc.totalPoints);
          stillAlive.push(arc);
        } else if (age < growMs + holdMs + fadeMs) {
          arc.material.opacity = 1 - (age - growMs - holdMs) / fadeMs;
          stillAlive.push(arc);
        } else {
          group.remove(arc.points);
          arc.points.geometry.dispose();
          arc.material.dispose();
        }
      }
      arcsRef.current = stillAlive;

      const rect = container!.getBoundingClientRect();
      markerMeshesRef.current.forEach((entry, id) => {
        const el = labelElsRef.current.get(id);
        if (!el) return;

        tmpWorldPos.copy(entry.mesh.position);
        group.localToWorld(tmpWorldPos);

        tmpNormal.copy(tmpWorldPos).normalize();
        tmpToCamera.copy(camera.position).sub(tmpWorldPos).normalize();
        const isFrontFacing = tmpNormal.dot(tmpToCamera) > 0.05;

        const projected = tmpWorldPos.clone().project(camera);
        const x = (projected.x * 0.5 + 0.5) * rect.width;
        const y = (-projected.y * 0.5 + 0.5) * rect.height;

        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.style.opacity = isFrontFacing ? '0.9' : '0';
      });

      renderer.render(scene, camera);
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      sphereGeometry.dispose();
      sphereMaterial.dispose();
      wireGeometry.dispose();
      wireMaterial.dispose();
      arcsRef.current.forEach((arc) => {
        arc.points.geometry.dispose();
        arc.material.dispose();
      });
      arcsRef.current = [];
      markerMeshesRef.current.forEach((entry) => {
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
      });
      markerMeshesRef.current.clear();

      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Marker sync: add/remove/recolor meshes when `markers` prop changes ──
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const currentIds = new Set(markers.map((m) => m.id));

    markerMeshesRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
        markerMeshesRef.current.delete(id);
      }
    });

    markers.forEach((marker) => {
      const existing = markerMeshesRef.current.get(marker.id);
      if (existing) {
        existing.online = marker.online;
        (existing.mesh.material as THREE.MeshBasicMaterial).color.set(marker.online ? '#e4007c' : '#525252');
        return;
      }
      const position = markerPosition(marker.id, RADIUS);
      const geometry = new THREE.SphereGeometry(0.045, 12, 12);
      const material = new THREE.MeshBasicMaterial({ color: marker.online ? '#e4007c' : '#525252' });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      group.add(mesh);
      markerMeshesRef.current.set(marker.id, { mesh, position, online: marker.online });
    });
  }, [markers]);

  // ─── Socket-driven arcs (+ idle fallback so the globe isn't static) ──
  useEffect(() => {
    const pickTwoIds = (): [string, string] | null => {
      const onlineIds = markersRef.current.filter((m) => m.online).map((m) => m.id);
      const pool = onlineIds.length >= 2 ? onlineIds : markersRef.current.map((m) => m.id);
      if (pool.length < 2) return null;
      const a = pool[Math.floor(Math.random() * pool.length)];
      let b = pool[Math.floor(Math.random() * pool.length)];
      let guard = 0;
      while (b === a && guard++ < 8) b = pool[Math.floor(Math.random() * pool.length)];
      return [a, b];
    };

    const trySpawn = () => {
      const pair = pickTwoIds();
      if (!pair || !spawnArcRef.current) return;
      spawnArcRef.current(pair[0], pair[1]);
      lastArcTimeRef.current = performance.now();
    };

    const socket = getSocket();
    const handleJobEvent = () => {
      if (performance.now() - lastArcTimeRef.current < 400) return; // throttle bursts
      trySpawn();
    };
    socket.on('job:created', handleJobEvent);
    socket.on('job:updated', handleJobEvent);

    const idleInterval = setInterval(() => {
      if (performance.now() - lastArcTimeRef.current > 5000) trySpawn();
    }, 3000);

    return () => {
      socket.off('job:created', handleJobEvent);
      socket.off('job:updated', handleJobEvent);
      clearInterval(idleInterval);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {markers.map((marker) => (
          <div
            key={marker.id}
            ref={(el) => {
              if (el) labelElsRef.current.set(marker.id, el);
              else labelElsRef.current.delete(marker.id);
            }}
            className="label-mono absolute left-0 top-0 -translate-x-1/2 -translate-y-6 whitespace-nowrap text-[10px] text-white/70 opacity-0 transition-opacity duration-200"
          >
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${marker.online ? 'bg-carbon-accent' : 'bg-white/30'}`} />
            {marker.online ? 'ONLINE' : 'OFFLINE'} · {marker.label}
          </div>
        ))}
      </div>
    </div>
  );
};
