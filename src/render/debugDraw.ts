// Ayudas visuales de depuración (F3): hitboxes, contactos de ruedas y vectores de velocidad.
import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
} from 'three';
import type { Car } from '../sim';

interface CarDebug {
  car: Car;
  box: LineSegments;
  wheels: Mesh[];
  vel: Line;
}

const on = new MeshBasicMaterial({ color: 0x40ff70 });
const off = new MeshBasicMaterial({ color: 0xff4040 });
const q = new Quaternion();

export class DebugDraw {
  readonly group = new Group();
  private items: CarDebug[] = [];

  constructor() {
    this.group.visible = false;
  }

  setCars(cars: readonly Car[]): void {
    for (const it of this.items) this.group.remove(it.box, it.vel, ...it.wheels);
    this.items = cars.map((car) => {
      const box = new LineSegments(
        new EdgesGeometry(new BoxGeometry(car.half.x * 2, car.half.y * 2, car.half.z * 2)),
        new LineBasicMaterial({ color: 0xffff00 }),
      );
      const wheels = [0, 1, 2, 3].map(() => new Mesh(new SphereGeometry(6, 8, 6), off));
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const vel = new Line(g, new LineBasicMaterial({ color: 0x40d0ff }));
      vel.frustumCulled = false;
      this.group.add(box, vel, ...wheels);
      return { car, box, wheels, vel };
    });
  }

  update(alpha: number): void {
    if (!this.group.visible) return;
    for (const { car, box, wheels, vel } of this.items) {
      box.position.set(
        car.prevPos.x + (car.pos.x - car.prevPos.x) * alpha,
        car.prevPos.y + (car.pos.y - car.prevPos.y) * alpha,
        car.prevPos.z + (car.pos.z - car.prevPos.z) * alpha,
      );
      q.set(car.prevQuat.x, car.prevQuat.y, car.prevQuat.z, car.prevQuat.w).slerp(
        new Quaternion(car.quat.x, car.quat.y, car.quat.z, car.quat.w),
        alpha,
      );
      box.quaternion.copy(q);
      wheels.forEach((w, i) => {
        const c = car.corners[i];
        w.position.set(c.x, c.y, c.z).applyQuaternion(q).add(box.position);
        w.material = car.wheelContact[i] ? on : off;
      });
      const pos = vel.geometry.getAttribute('position');
      pos.setXYZ(0, box.position.x, box.position.y, box.position.z);
      pos.setXYZ(
        1,
        box.position.x + car.vel.x * 0.15,
        box.position.y + car.vel.y * 0.15,
        box.position.z + car.vel.z * 0.15,
      );
      pos.needsUpdate = true;
    }
  }
}
