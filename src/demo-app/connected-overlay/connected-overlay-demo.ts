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


let itemCount = 25;

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
  isFlexible = false;
  canPush = true;
  showBoundingBox = false;

  overlayRef: OverlayRef | null;

  constructor(
      public overlay: Overlay,
      public viewContainerRef: ViewContainerRef,
      public dir: Directionality) { }

  openWithConfig() {
    let strategy = this.overlay.position()
        .betterConnectedTo(this._overlayOrigin.elementRef)
        .withFlexibleHeight(this.isFlexible)
        .withFlexibleWidth(this.isFlexible)
        .withPush(this.canPush)
        .withViewportMargin(10)
        .withPositions([{
          originX: this.originX,
          originY: this.originY,
          overlayX: this.overlayX,
          overlayY: this.overlayY,
          weight: 2,
        },
        // {
        //   originX: 'start',
        //   originY: 'top',
        //   overlayX: 'start',
        //   overlayY: 'bottom',
        // },
        // {
        //   originX: 'start',
        //   originY: 'bottom',
        //   overlayX: 'start',
        //   overlayY: 'top',
        // },
        ]);

    // strategy.positionChange.subscribe(e => {
    //   console.log('position: ', e);
    // });

    let config = new OverlayState();
    config.positionStrategy = strategy;
    config.direction = this.dir.value;
    config.minHeight = 50;
    //config.maxHeight = 250;

    config.scrollStrategy = this.overlay.scrollStrategies.reposition();

    this.overlayRef = this.overlay.create(config);
    this.overlayRef.attach(new ComponentPortal(DemoOverlay, this.viewContainerRef));
  }

  close() {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.showBoundingBox = false;
    }
  }

  updateCount(value: number) {
    itemCount = +value;
  }

  toggleShowBoundingBox() {
    const box = document.querySelector('.cdk-overlay-connected-pos-bounding-box');

    if (box) {
      this.showBoundingBox = !this.showBoundingBox;
      box.classList.toggle('demo-show-box');
    }
  }
}


@Component({
  selector: 'demo-overlay',
  template: `
    <div style="overflow: auto;">
      {{items.length}}
      <ul><li *ngFor="let item of items; index as i">item {{i}}</li></ul>
    </div>`,
  encapsulation: ViewEncapsulation.None,
})
export class DemoOverlay {
  items = Array(itemCount);
}

