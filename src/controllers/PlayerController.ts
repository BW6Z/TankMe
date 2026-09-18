/** Maps raw input to tank controls. The turret follows the camera aim. */
import type { Tank } from '../tank/Tank';
import type { Input } from '../core/Input';
import type { CameraRig } from '../camera/CameraRig';

export class PlayerController {
  constructor(private input: Input, private cameraRig: CameraRig) {}

  update(_dt: number, tank: Tank): void {
    const i = this.input;
    const fwd = (i.isDown('KeyW') ? 1 : 0) - (i.isDown('KeyS') ? 1 : 0);
    tank.input.throttle = fwd;
    tank.input.steer = (i.isDown('KeyA') ? 1 : 0) - (i.isDown('KeyD') ? 1 : 0);
    tank.input.brake = i.isDown('Space');
    tank.input.aim.copy(this.cameraRig.aimPoint);
    tank.input.fire = i.buttonDown(0);
  }
}
