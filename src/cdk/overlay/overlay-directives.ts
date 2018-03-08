/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Direction, Directionality} from '@angular/cdk/bidi';
import {coerceBooleanProperty} from '@angular/cdk/coercion';
import {ESCAPE} from '@angular/cdk/keycodes';
import {TemplatePortal} from '@angular/cdk/portal';
import {ScrollDispatcher, ViewportRuler} from '@angular/cdk/scrolling';
import {
  APP_ROOT_SCOPE,
  Directive,
  ElementRef,
  EventEmitter,
  Inject,
  inject,
  InjectionToken,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Optional,
  Output,
  SimpleChanges,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import {Subscription} from 'rxjs/Subscription';
import {Overlay} from './overlay';
import {OverlayConfig} from './overlay-config';
import {OverlayRef} from './overlay-ref';
import {
  ConnectedOverlayPositionChange,
  ConnectionPositionPair,
} from './position/connected-position';
import {ConnectedPositionStrategy} from './position/connected-position-strategy';
import {
  RepositionScrollStrategy,
  RepositionScrollStrategyConfig,
  ScrollStrategy,
} from './scroll/index';


/** Default set of positions for the overlay. Follows the behavior of a dropdown. */
const defaultPositionList = [
  new ConnectionPositionPair(
      {originX: 'start', originY: 'bottom'},
      {overlayX: 'start', overlayY: 'top'}),
  new ConnectionPositionPair(
      {originX: 'start', originY: 'top'},
      {overlayX: 'start', overlayY: 'bottom'}),
  new ConnectionPositionPair(
    {originX: 'end', originY: 'top'},
    {overlayX: 'end', overlayY: 'bottom'}),
  new ConnectionPositionPair(
    {originX: 'end', originY: 'bottom'},
    {overlayX: 'end', overlayY: 'top'}),
];

/** Injection token that determines the scroll handling while the connected overlay is open. */
export const CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY =
    new InjectionToken<() => ScrollStrategy>('cdk-connected-overlay-scroll-strategy', {
  scope: APP_ROOT_SCOPE,
  factory: () => {
    // Store the injected deps here because we can't use the `inject` function outside
    // this function's context (including the inner function).
    const scrollDispatcher = inject(ScrollDispatcher);
    const viewportRuler = inject(ViewportRuler);
    const ngZone = inject(NgZone);
    return (config?: RepositionScrollStrategyConfig) =>
        new RepositionScrollStrategy(scrollDispatcher, viewportRuler, ngZone, config);
  },
});

/**
 * Directive applied to an element to make it usable as an origin for an Overlay using a
 * ConnectedPositionStrategy.
 */
@Directive({
  selector: '[cdk-overlay-origin], [overlay-origin], [cdkOverlayOrigin]',
  exportAs: 'cdkOverlayOrigin',
})
export class CdkOverlayOrigin {
  constructor(
      /** Reference to the element on which the directive is applied. */
      public elementRef: ElementRef) { }
}


/**
 * Directive to facilitate declarative creation of an Overlay using a ConnectedPositionStrategy.
 */
@Directive({
  selector: '[cdk-connected-overlay], [connected-overlay], [cdkConnectedOverlay]',
  exportAs: 'cdkConnectedOverlay'
})
export class CdkConnectedOverlay implements OnDestroy, OnChanges {
  private _overlayRef: OverlayRef;
  private _templatePortal: TemplatePortal;
  private _hasBackdrop = false;
  private _lockPosition = false;
  private _backdropSubscription = Subscription.EMPTY;
  private _offsetX: number = 0;
  private _offsetY: number = 0;
  private _position: ConnectedPositionStrategy;

  /** Origin for the connected overlay. */
  @Input('cdkConnectedOverlayOrigin') origin: CdkOverlayOrigin;

  /** Registered connected position pairs. */
  @Input('cdkConnectedOverlayPositions') positions: ConnectionPositionPair[];

  /** The offset in pixels for the overlay connection point on the x-axis */
  @Input('cdkConnectedOverlayOffsetX')
  get offsetX(): number { return this._offsetX; }
  set offsetX(offsetX: number) {
    this._offsetX = offsetX;
    if (this._position) {
      this._position.withOffsetX(offsetX);
    }
  }

  /** The offset in pixels for the overlay connection point on the y-axis */
  @Input('cdkConnectedOverlayOffsetY')
  get offsetY() { return this._offsetY; }
  set offsetY(offsetY: number) {
    this._offsetY = offsetY;
    if (this._position) {
      this._position.withOffsetY(offsetY);
    }
  }

  /** The width of the overlay panel. */
  @Input('cdkConnectedOverlayWidth') width: number | string;

  /** The height of the overlay panel. */
  @Input('cdkConnectedOverlayHeight') height: number | string;

  /** The min width of the overlay panel. */
  @Input('cdkConnectedOverlayMinWidth') minWidth: number | string;

  /** The min height of the overlay panel. */
  @Input('cdkConnectedOverlayMinHeight') minHeight: number | string;

  /** The custom class to be set on the backdrop element. */
  @Input('cdkConnectedOverlayBackdropClass') backdropClass: string;

  /** Strategy to be used when handling scroll events while the overlay is open. */
  @Input('cdkConnectedOverlayScrollStrategy') scrollStrategy: ScrollStrategy =
      this._scrollStrategy();

  /** Whether the overlay is open. */
  @Input('cdkConnectedOverlayOpen') open: boolean = false;

  /** Whether or not the overlay should attach a backdrop. */
  @Input('cdkConnectedOverlayHasBackdrop')
  get hasBackdrop() { return this._hasBackdrop; }
  set hasBackdrop(value: any) { this._hasBackdrop = coerceBooleanProperty(value); }

  /** Whether or not the overlay should be locked when scrolling. */
  @Input('cdkConnectedOverlayLockPosition')
  get lockPosition() { return this._lockPosition; }
  set lockPosition(value: any) { this._lockPosition = coerceBooleanProperty(value); }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('origin')
  get _deprecatedOrigin(): CdkOverlayOrigin { return this.origin; }
  set _deprecatedOrigin(_origin: CdkOverlayOrigin) { this.origin = _origin; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('positions')
  get _deprecatedPositions(): ConnectionPositionPair[] { return this.positions; }
  set _deprecatedPositions(_positions: ConnectionPositionPair[]) { this.positions = _positions; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('offsetX')
  get _deprecatedOffsetX(): number { return this.offsetX; }
  set _deprecatedOffsetX(_offsetX: number) { this.offsetX = _offsetX; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('offsetY')
  get _deprecatedOffsetY(): number { return this.offsetY; }
  set _deprecatedOffsetY(_offsetY: number) { this.offsetY = _offsetY; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('width')
  get _deprecatedWidth(): number | string { return this.width; }
  set _deprecatedWidth(_width: number | string) { this.width = _width; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('height')
  get _deprecatedHeight(): number | string { return this.height; }
  set _deprecatedHeight(_height: number | string) { this.height = _height; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('minWidth')
  get _deprecatedMinWidth(): number | string { return this.minWidth; }
  set _deprecatedMinWidth(_minWidth: number | string) { this.minWidth = _minWidth; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('minHeight')
  get _deprecatedMinHeight(): number | string { return this.minHeight; }
  set _deprecatedMinHeight(_minHeight: number | string) { this.minHeight = _minHeight; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('backdropClass')
  get _deprecatedBackdropClass(): string { return this.backdropClass; }
  set _deprecatedBackdropClass(_backdropClass: string) { this.backdropClass = _backdropClass; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('scrollStrategy')
  get _deprecatedScrollStrategy(): ScrollStrategy { return this.scrollStrategy; }
  set _deprecatedScrollStrategy(_scrollStrategy: ScrollStrategy) {
    this.scrollStrategy = _scrollStrategy;
  }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('open')
  get _deprecatedOpen(): boolean { return this.open; }
  set _deprecatedOpen(_open: boolean) { this.open = _open; }

  /**
   * @deprecated
   * @deletion-target 6.0.0
   */
  @Input('hasBackdrop')
  get _deprecatedHasBackdrop() { return this.hasBackdrop; }
  set _deprecatedHasBackdrop(_hasBackdrop: any) { this.hasBackdrop = _hasBackdrop; }

  /** Event emitted when the backdrop is clicked. */
  @Output() backdropClick = new EventEmitter<MouseEvent>();

  /** Event emitted when the position has changed. */
  @Output() positionChange = new EventEmitter<ConnectedOverlayPositionChange>();

  /** Event emitted when the overlay has been attached. */
  @Output() attach = new EventEmitter<void>();

  /** Event emitted when the overlay has been detached. */
  @Output() detach = new EventEmitter<void>();

  // TODO(jelbourn): inputs for size, scroll behavior, animation, etc.

  constructor(
      private _overlay: Overlay,
      templateRef: TemplateRef<any>,
      viewContainerRef: ViewContainerRef,
      @Inject(CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY) private _scrollStrategy,
      @Optional() private _dir: Directionality) {
    this._templatePortal = new TemplatePortal(templateRef, viewContainerRef);
  }

  /** The associated overlay reference. */
  get overlayRef(): OverlayRef {
    return this._overlayRef;
  }

  /** The element's layout direction. */
  get dir(): Direction {
    return this._dir ? this._dir.value : 'ltr';
  }

  ngOnDestroy() {
    this._destroyOverlay();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this._position) {
      if (changes['positions'] || changes['_deprecatedPositions']) {
        this._position.withPositions(this.positions);
      }

      if (changes['lockPosition']) {
        this._position.withLockedPosition(this.lockPosition);
      }

      if (changes['origin'] || changes['_deprecatedOrigin']) {
        this._position.setOrigin(this.origin.elementRef);

        if (this.open) {
          this._position.apply();
        }
      }
    }

    if (changes['open'] || changes['_deprecatedOpen']) {
      this.open ? this._attachOverlay() : this._detachOverlay();
    }
  }

  /** Creates an overlay */
  private _createOverlay() {
    if (!this.positions || !this.positions.length) {
      this.positions = defaultPositionList;
    }

    this._overlayRef = this._overlay.create(this._buildConfig());
  }

  /** Builds the overlay config based on the directive's inputs */
  private _buildConfig(): OverlayConfig {
    const positionStrategy = this._position = this._createPositionStrategy();
    const overlayConfig = new OverlayConfig({
      positionStrategy,
      scrollStrategy: this.scrollStrategy,
      hasBackdrop: this.hasBackdrop
    });

    if (this.width || this.width === 0) {
      overlayConfig.width = this.width;
    }

    if (this.height || this.height === 0) {
      overlayConfig.height = this.height;
    }

    if (this.minWidth || this.minWidth === 0) {
      overlayConfig.minWidth = this.minWidth;
    }

    if (this.minHeight || this.minHeight === 0) {
      overlayConfig.minHeight = this.minHeight;
    }

    if (this.backdropClass) {
      overlayConfig.backdropClass = this.backdropClass;
    }

    return overlayConfig;
  }

  /** Returns the position strategy of the overlay to be set on the overlay config */
  private _createPositionStrategy(): ConnectedPositionStrategy {
    const primaryPosition = this.positions[0];
    const originPoint = {originX: primaryPosition.originX, originY: primaryPosition.originY};
    const overlayPoint = {overlayX: primaryPosition.overlayX, overlayY: primaryPosition.overlayY};
    const strategy = this._overlay.position()
      .connectedTo(this.origin.elementRef, originPoint, overlayPoint)
      .withOffsetX(this.offsetX)
      .withOffsetY(this.offsetY)
      .withLockedPosition(this.lockPosition);

    for (let i = 1; i < this.positions.length; i++) {
      strategy.withFallbackPosition(
          {originX: this.positions[i].originX, originY: this.positions[i].originY},
          {overlayX: this.positions[i].overlayX, overlayY: this.positions[i].overlayY}
      );
    }

    strategy.onPositionChange.subscribe(pos => this.positionChange.emit(pos));

    return strategy;
  }

  /** Attaches the overlay and subscribes to backdrop clicks if backdrop exists */
  private _attachOverlay() {
    if (!this._overlayRef) {
      this._createOverlay();

      this._overlayRef!.keydownEvents().subscribe((event: KeyboardEvent) => {
        if (event.keyCode === ESCAPE) {
          this._detachOverlay();
        }
      });
    } else {
      // Update the overlay size, in case the directive's inputs have changed
      this._overlayRef.updateSize({
        width: this.width,
        minWidth: this.minWidth,
        height: this.height,
        minHeight: this.minHeight,
      });
    }

    this._position.withDirection(this.dir);
    this._overlayRef.setDirection(this.dir);

    if (!this._overlayRef.hasAttached()) {
      this._overlayRef.attach(this._templatePortal);
      this.attach.emit();
    }

    if (this.hasBackdrop) {
      this._backdropSubscription = this._overlayRef.backdropClick().subscribe(event => {
        this.backdropClick.emit(event);
      });
    }
  }

  /** Detaches the overlay and unsubscribes to backdrop clicks if backdrop exists */
  private _detachOverlay() {
    if (this._overlayRef) {
      this._overlayRef.detach();
      this.detach.emit();
    }

    this._backdropSubscription.unsubscribe();
  }

  /** Destroys the overlay created by this directive. */
  private _destroyOverlay() {
    if (this._overlayRef) {
      this._overlayRef.dispose();
    }

    this._backdropSubscription.unsubscribe();
  }
}


/** @docs-private @deprecated @deletion-target 7.0.0 */
export function CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY_PROVIDER_FACTORY(overlay: Overlay):
    () => RepositionScrollStrategy {
  return () => overlay.scrollStrategies.reposition();
}

/** @docs-private @deprecated @deletion-target 7.0.0 */
export const CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY_PROVIDER = {
  provide: CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY,
  deps: [Overlay],
  useFactory: CDK_CONNECTED_OVERLAY_SCROLL_STRATEGY_PROVIDER_FACTORY,
};
