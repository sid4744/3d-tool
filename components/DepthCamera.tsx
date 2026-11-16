import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { head, trackingSettings, metersPerCssPx } from '../hooks/useHeadTracking';

/**
 * Turns the viewport into a window onto the scene ("fish-tank VR").
 *
 * The orbit camera still decides *what* you are looking at (target, direction, zoom). This
 * component then treats the canvas as a physical window of that framing and re-projects the
 * scene from where your eyes actually are, using an off-axis frustum. Moving your head
 * changes parallax the way looking through a real window would.
 */
export const DepthCamera = ({ active }: { active: boolean }) => {
  const { camera, gl, controls } = useThree();
  const base = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), valid: false });
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const eyeSmooth = useRef({ x: 0, y: 0, z: 0.55 });
  const tmp = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 };
    };
    addEventListener('mousemove', onMove);
    return () => {
      removeEventListener('mousemove', onMove);
      // Hand the camera back to the normal orbit pipeline.
      if (base.current.valid) {
        camera.position.copy(base.current.pos);
        camera.quaternion.copy(base.current.quat);
        camera.updateMatrixWorld();
      }
      base.current.valid = false;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    };
  }, [active, camera]);

  // Undo last frame's eye offset *before* OrbitControls (priority -1) integrates user input.
  useFrame(() => {
    if (!active || !base.current.valid) return;
    camera.position.copy(base.current.pos);
    camera.quaternion.copy(base.current.quat);
    camera.updateMatrixWorld();
  }, -2);

  useFrame(() => {
    if (!active) return;
    const cam = camera as THREE.PerspectiveCamera;
    base.current.pos.copy(cam.position);
    base.current.quat.copy(cam.quaternion);
    base.current.valid = true;

    const target: THREE.Vector3 = (controls as any)?.target ?? tmp.current.set(0, 0, 0);
    const dist = cam.position.distanceTo(target);

    const rect = gl.domElement.getBoundingClientRect();
    const pitch = metersPerCssPx();
    const wPhys = rect.width * pitch;
    const hPhys = rect.height * pitch;

    // Where are the eyes, relative to the centre of the canvas, in metres?
    let hx = 0, hy = 0, hz = 0.55;
    if (performance.now() - head.lastSeen < 600) {
      const cxPx = window.screenX + rect.left + rect.width / 2 - screen.width / 2;
      const cyPx = window.screenY + (outerHeight - innerHeight) + rect.top + rect.height / 2 - screen.height / 2;
      hx = head.x - cxPx * pitch;
      hy = head.y + cyPx * pitch;
      hz = head.z;
    } else if (mouse.current) {
      hx = mouse.current.x * wPhys * 1.2;
      hy = -mouse.current.y * hPhys * 1.2;
    }
    const s = eyeSmooth.current;
    s.x += (hx - s.x) * 0.5; s.y += (hy - s.y) * 0.5; s.z += (hz - s.z) * 0.5;

    // Physical metres → scene units: the canvas shows `sceneW` units across the target plane.
    const fovRad = THREE.MathUtils.degToRad(cam.fov);
    const sceneH = 2 * Math.tan(fovRad / 2) * dist;
    const sceneW = sceneH * cam.aspect;
    const k = sceneW / Math.max(wPhys, 1e-3);

    const ex = s.x * trackingSettings.strength * k;
    const ey = s.y * trackingSettings.strength * k;
    const ez = Math.max(s.z * k, cam.near * 4);

    cam.position.copy(target).add(tmp.current.set(ex, ey, ez).applyQuaternion(base.current.quat));
    cam.updateMatrixWorld();

    // Off-axis frustum: the canvas rectangle is the window, the eye is the apex.
    const n = cam.near, f = cam.far, q = n / ez;
    const hw = sceneW / 2, hh = sceneH / 2;
    cam.projectionMatrix.makePerspective((-hw - ex) * q, (hw - ex) * q, (hh - ey) * q, (-hh - ey) * q, n, f);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }, 0);

  return null;
};
