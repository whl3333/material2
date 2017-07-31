import {Component, ViewChild, ViewContainerRef, ViewEncapsulation} from '@angular/core';
import {
  ComponentPortal,
  Directionality,
  HorizontalConnectionPos,
  Overlay,
  OverlayOrigin,
  OverlayRef,
  OverlayState,
  VerticalConnectionPos
} from '@angular/material';


let itemCount = 5;

@Component({
  moduleId: module.id,
  selector: 'overlay-demo',
  templateUrl: 'connected-overlay-demo.html',
  styleUrls: ['connected-overlay-demo.css'],
  encapsulation: ViewEncapsulation.None,
})
export class ConnectedOverlayDemo {
  @ViewChild(OverlayOrigin) _overlayOrigin: OverlayOrigin;

  originX: HorizontalConnectionPos = 'start';
  originY: VerticalConnectionPos = 'bottom';
  overlayX: HorizontalConnectionPos = 'start';
  overlayY: VerticalConnectionPos = 'top';

  overlayRef: OverlayRef | null;

  constructor(
      public overlay: Overlay,
      public viewContainerRef: ViewContainerRef,
      public dir: Directionality) { }

  openWithConfig() {
    let strategy = this.overlay.position()
        .betterConnectedTo(this._overlayOrigin.elementRef)
        .withPositions([{
          originX: this.originX,
          originY: this.originY,
          overlayX: this.overlayX,
          overlayY: this.overlayY,
          weight: 2,
        }, {
          originX: this.originX,
          originY: this.originY,
          overlayX: this.overlayX,
          overlayY: this.overlayY,
        }]);

    let config = new OverlayState();
    config.positionStrategy = strategy;
    config.direction = this.dir.value;

    this.overlayRef = this.overlay.create(config);
    this.overlayRef.attach(new ComponentPortal(DemoOverlay, this.viewContainerRef));
  }

  close() {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
  }

  updateCount(value: number) {
    itemCount = +value;
  }
}


@Component({
  selector: 'demo-overlay',
  template: '<ul><li *ngFor="let item of items; index as i">item {{i}}</li></ul>',
  encapsulation: ViewEncapsulation.None,
})
export class DemoOverlay {
  items = Array(itemCount);
}

