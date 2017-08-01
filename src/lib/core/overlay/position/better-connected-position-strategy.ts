/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {PositionStrategy} from './position-strategy';
import {ElementRef} from '@angular/core';
import {ViewportRuler} from './viewport-ruler';
import {
  ConnectedOverlayPositionChange,
  ConnectionPositionPair,
  ScrollableViewProperties
} from './connected-position';
import {Subject} from 'rxjs/Subject';
import {Observable} from 'rxjs/Observable';
import {Scrollable} from '../scroll/scrollable';
import {extendObject} from '../../util/object-extend';
import {OverlayRef} from '../overlay-ref';


// TODO: ensure that overlay content is fully rendered before positioning.
//    This is a change to OverlayRef. Exploring defering the initial positioning until onStable.
//    Need to confirm w/ Matias that this *reliably* happens before animations start.

// TODO: push origin point on-screen when no positions would be on-screen.
//       This plays into the logic for picking a position, so probably deals with min-height again.


// TODO: able to turn off flexible size
// TODO: add setting for *when* to pick a new position
//     (in attempt to remove `recalculateLastPosition`)
//     Times when you owuld want to reposition: content change, scroll, window resize
//     Content change example: typing in an autocomplete changes the number of options, leading
//         to a different fit. Would want to re-use the last position in this case


// TODO: use cached ClientRects when possible
// - Only invalidate viewport rect on scroll / resize.
// - Only invalidate origin rect and overlay rect on content change (mutation observer?)
//
// Nothing captures the styles of the viewport/origin changing (esp. wrt cascading stlyes),
// but this may be a decent tradeoff for avoiding recalculating




// TODO: refactor clipping detection into a separate file
// TODO: add offsets and origin element to a per-position setting
// TODO: attribute selector to specify the transform-origin inside the overlay content
// TODO: unit tests


// TODO: create `DropdownPositionStrategy` and `TooltipPositionStrategy`, which are pre-configured
//       connected position strategies
// TODO: change existing components to new strategy



/**
 * Container to hold the bounding positions of a particular element with respect to the viewport,
 * where top and bottom are the y-axis coordinates of the bounding rectangle and left and right are
 * the x-axis coordinates.
 */
type ElementBoundingPositions = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * A strategy for positioning overlays. Using this strategy, an overlay is given an
 * implicit position relative some origin element. The relative position is defined in terms of
 * a point on the origin element that is connected to a point on the overlay element. For example,
 * a basic dropdown is connecting the bottom-left corner of the origin to the top-left corner
 * of the overlay.
 */
export class BetterConnectedPositionStrategy implements PositionStrategy {
  /** The overlay to which this strategy is attached. */
  private _overlayRef: OverlayRef;

  /** Whether we're performing the very first positioning of the overlay. */
  private _isInitialRender = true;

  /** Whether the overlay was pushed in a previous positioning. */
  private _isPushed = false;

  /** Whether the overlay can be pushed on-screen  */
  private _canPush = true;

  private _hasFlexibleHeight = true;

  private _hasFlexibleWidth = true;

  private _originRect: ClientRect;

  private _overlayRect: ClientRect;

  private _viewportRect: ClientRect;

  /** Amount of space that must be maintained between the overlay and the edge of the viewport. */
  private _viewportMargin: number = 0;

  /** The Scrollable containers used to check scrollable view properties on position change. */
  private scrollables: Scrollable[] = [];

  /** Ordered list of preferred positions, from most to least desirable. */
  _preferredPositions: ConnectionPositionPair[] = [];

  /** The origin element against which the overlay will be positioned. */
  private _origin: HTMLElement;

  /** The overlay pane element. */
  private _pane: HTMLElement;

  /**
   * Parent element for the overlay panel used to constrain the overlay panel's size to fit
   * within the viewport.
   */
  private _boundingBox: HTMLDivElement;

  /** The last position to have been calculated as the best fit position. */
  private _lastConnectedPosition: ConnectionPositionPair;

  _onPositionChange:
      Subject<ConnectedOverlayPositionChange> = new Subject<ConnectedOverlayPositionChange>();

  /** Emits an event when the connection point changes. */
  get onPositionChange(): Observable<ConnectedOverlayPositionChange> {
    return this._onPositionChange.asObservable();
  }

  /** Whether the we're dealing with an RTL context */
  private _isRtl() {
    return this._overlayRef.getState().direction === 'rtl';
  }

  /** Ordered list of preferred positions, from most to least desirable. */
  get positions() { return this._preferredPositions; }

  constructor(private _connectedTo: ElementRef, private _viewportRuler: ViewportRuler) {
    this._origin = this._connectedTo.nativeElement;
  }

  attach(overlayRef: OverlayRef): void {
    this._overlayRef = overlayRef;
    this._pane = overlayRef.overlayElement;
  }

  /** Cleanup after the element gets destroyed. */
  dispose() {
    if (this._boundingBox && this._boundingBox.parentNode) {
      this._boundingBox.parentNode.removeChild(this._boundingBox);
    }
  }

  /**
   * Updates the position of the overlay element, using whichever preferred position relative
   * to the origin fits on-screen.
   * @docs-private
   */
  apply(): void {
    const element = this._pane;

    if (this._isInitialRender) {
      // If we haven't attached the element to its sizing container yet, do so now.
      this._boundingBox = this._creatingBoundingBox();
      if (element.parentNode && element.parentNode !== this._boundingBox) {
        element.parentNode.insertBefore(this._boundingBox, element);
        this._boundingBox.appendChild(element);
      }

      // We need the bounding rects for the origin and the overlay to determine how to position
      // the overlay relative to the origin.
      this._originRect = this._origin.getBoundingClientRect();
      this._overlayRect = element.getBoundingClientRect();

      // We use the viewport rect to determine whether a position would go off-screen.
      this._viewportRect = this._narrowViewportRect(this._viewportRuler.getViewportRect());

      // TODO: need to limit when we update these rects
      // this._isInitialRender = false;
    }

    const originRect = this._originRect;
    const overlayRect = this._overlayRect;
    const viewportRect = this._viewportRect;

    // Positions where the overlay will fit with flexible dimensions.
    const flexibleFits: FlexibleFit[] = [];

    // Fallback if none of the preferred positions fit within the viewport.
    let fallback: FallbackPosition | undefined;

    // Go through each of the preferred positions looking for a good fit. If a good fit is found,
    // it will be applied immediately.
    for (let pos of this._preferredPositions) {

      // Get the (x, y) point of connection on the origin, and then use that to get the
      // (top, left) coordinate for the overlay at `pos`.

      // Get the exact (x, y) coordinate for the point-of-origin on the origin element.
      let originPoint = this._getOriginConnectionPoint(originRect, pos);

      // From that point-of-origin, get the exact (x, y) coordinate for the top-left corner of the
      // overlay in this position. We use the top-left corner for calculations and later translate
      // this into an appropriate (top, left, bottom, right) style.
      let overlayPoint = this._getOverlayPoint(originPoint, overlayRect, pos);

      // Calculate how well the overlay would fit into the viewport with this point.
      let overlayFit = this._getOverlayFit(overlayPoint, overlayRect, viewportRect);

      // If the overlay, without any further work, fits into the viewport, use this position.
      if (overlayFit.isCompletelyWithinViewport) {
        this._applyPosition(element, pos, originPoint, viewportRect);
        return;
      }

      // If the overlay has flexible dimensions, we can use this position so long as there's enough
      // space for the minimum dimensions.
      if (this._canFitWithFlexibleDimensions(overlayFit, overlayPoint, viewportRect)) {
        // Save positions where the overlay will fit with flexible dimensions. We will use these
        // if none of the positions fit *without* flexible dimensions.
        flexibleFits.push({
          position: pos,
          origin: originPoint,
          overlayRect,
          boundingBoxRect: this._calculateBoundingBoxRect(originPoint, pos, viewportRect)
        });

        continue;
      }

      // If the current preferred position does not fit on the screen, remember the position
      // if it has more visible area on-screen than we've seen and move onto the next preferred
      // position.
      if (!fallback || fallback.overlayFit.visibleArea < overlayFit.visibleArea) {
        fallback = {overlayFit, overlayPoint, originPoint, pos, overlayRect};
      }
    }

    // If there are any positions where the overlay would fit with flexible dimensions, choose the
    // one that has the greatest area available modified by the position's weight
    if (flexibleFits.length) {
      let bestFit: FlexibleFit | null = null;
      let bestScore = 0;
      for (const fit of flexibleFits) {
        const score =
            fit.boundingBoxRect.width * fit.boundingBoxRect.height * (fit.position.weight || 1);
        if (score > bestScore) {
          bestScore = score;
          bestFit = fit;
        }
      }

      this._applyPosition(element, bestFit!.position, bestFit!.origin, viewportRect);
      return;
    }

    // When none of the preferred positions exactly fit within the viewport, take the position
    // that went off-screen the least and attempt to push it on-screen.
    if (this._canPush) {
      // TODO: make this work
      // note to future jeremy: pushing the overlay is equivalent to moving the ORIGIN point
      const pushedPoint =
          this._pushOverlayOnScreen(fallback!.overlayPoint, overlayRect, viewportRect);
      this._applyPosition(element, fallback!.pos, fallback!.originPoint, viewportRect);
      return;
    }

    // All options for getting the overlay within the viewport have been exhausted, so go with the
    // position that went off-screen the least.
    this._applyPosition(element, fallback!.pos, fallback!.originPoint, viewportRect);
  }

  /**
   * This re-aligns the overlay element with the trigger in its last calculated position,
   * even if a position higher in the "preferred positions" list would now fit. This
   * allows one to re-align the panel without changing the orientation of the panel.
   */
  recalculateLastPosition(): void {
    // todo: don't recalculate
    const originRect = this._origin.getBoundingClientRect();
    const viewportRect = this._narrowViewportRect(this._viewportRuler.getViewportRect());
    const lastPosition = this._lastConnectedPosition || this._preferredPositions[0];

    let originPoint = this._getOriginConnectionPoint(originRect, lastPosition);
    this._applyPosition(this._pane, this._lastConnectedPosition, originPoint, viewportRect);
  }

  /**
   * Sets the list of Scrollable containers that host the origin element so that
   * on reposition we can evaluate if it or the overlay has been clipped or outside view. Every
   * Scrollable must be an ancestor element of the strategy's origin element.
   */
  withScrollableContainers(scrollables: Scrollable[]) {
    this.scrollables = scrollables;
  }

  /**
   * Adds a new preferred fallback position.
   * @param positions List of positions options for this overlay.
   */
  withPositions(positions: ConnectedPosition[]): this {
    this._preferredPositions = positions;
    return this;
  }

  withViewportMargin(margin: number): this {
    this._viewportMargin = margin;
    return this;
  }

  /**
   * Gets the horizontal (x) "start" dimension based on whether the overlay is in an RTL context.
   * @param rect
   */
  private _getStartX(rect: ClientRect): number {
    return this._isRtl() ? rect.right : rect.left;
  }

  /**
   * Gets the horizontal (x) "end" dimension based on whether the overlay is in an RTL context.
   * @param rect
   */
  private _getEndX(rect: ClientRect): number {
    return this._isRtl() ? rect.left : rect.right;
  }


  /**
   * Gets the (x, y) coordinate of a connection point on the origin based on a relative position.
   * @param originRect
   * @param pos
   */
  private _getOriginConnectionPoint(originRect: ClientRect, pos: ConnectionPositionPair): Point {
    const originStartX = this._getStartX(originRect);
    const originEndX = this._getEndX(originRect);

    let x: number;
    if (pos.originX == 'center') {
      x = originStartX + (originRect.width / 2);
    } else {
      x = pos.originX == 'start' ? originStartX : originEndX;
    }

    let y: number;
    if (pos.originY == 'center') {
      y = originRect.top + (originRect.height / 2);
    } else {
      y = pos.originY == 'top' ? originRect.top : originRect.bottom;
    }

    return {x, y};
  }


  /**
   * Gets the (x, y) coordinate of the top-left corner of the overlay given a given position and
   * origin point to which the overlay should be connected.
   */
  private _getOverlayPoint(
      originPoint: Point,
      overlayRect: ClientRect,
      pos: ConnectedPosition): Point {
    // Calculate the (overlayStartX, overlayStartY), the start of the potential overlay position
    // relative to the origin point.
    let overlayStartX: number;
    if (pos.overlayX == 'center') {
      overlayStartX = -overlayRect.width / 2;
    } else if (pos.overlayX === 'start') {
      overlayStartX = this._isRtl() ? -overlayRect.width : 0;
    } else {
      overlayStartX = this._isRtl() ? 0 : -overlayRect.width;
    }

    let overlayStartY: number;
    if (pos.overlayY == 'center') {
      overlayStartY = -overlayRect.height / 2;
    } else {
      overlayStartY = pos.overlayY == 'top' ? 0 : -overlayRect.height;
    }

    // The (x, y) coordinates of the overlay.
    return {
      x: originPoint.x + overlayStartX,
      y: originPoint.y + overlayStartY,
    };
  }

  /** Gets how well an overlay at the given point will fit within the viewport. */
  private _getOverlayFit(point: Point, overlay: ClientRect, viewport: ClientRect): OverlayFit {
    const {x, y} = point;

    // How much the overlay would overflow at this position, on each side.
    let leftOverflow = 0 - x;
    let rightOverflow = (x + overlay.width) - viewport.width;
    let topOverflow = 0 - y;
    let bottomOverflow = (y + overlay.height) - viewport.height;

    // Visible parts of the element on each axis.
    let visibleWidth = this._subtractOverflows(overlay.width, leftOverflow, rightOverflow);
    let visibleHeight = this._subtractOverflows(overlay.height, topOverflow, bottomOverflow);
    let visibleArea = visibleWidth * visibleHeight;

    return {
      visibleArea,
      isCompletelyWithinViewport: (overlay.width * overlay.height) === visibleArea,
      fitsInViewportVertically: visibleHeight === overlay.height,
      fitsInViewportHorizontally: visibleWidth == overlay.width,
    };
  }

  /**
   * Whether the overlay can fit within the viewport when it may resize either its width or height.
   * @param fit How well the overlay fits in the viewport at some position.
   * @param point The (x, y) coordinates of the overlat at some position.
   * @param viewport The geometry of the viewport.
   */
  private _canFitWithFlexibleDimensions(fit: OverlayFit, point: Point, viewport: ClientRect) {
    if (this._hasFlexibleWidth || this._hasFlexibleWidth) {
      const availableHeight = viewport.bottom - point.y;
      const availableWidth = viewport.right - point.x;
      const minHeight = this._overlayRef.getState().minHeight || 0;
      const minWidth = this._overlayRef.getState().minWidth || 0;

      const verticalFit = fit.fitsInViewportVertically ||
          (this._hasFlexibleHeight && minHeight <= availableHeight);
      const horizontalFit = fit.fitsInViewportHorizontally ||
          (this._hasFlexibleWidth && minWidth <= availableWidth);

      return verticalFit && horizontalFit;
    }
  }

  private _pushOverlayOnScreen(point: Point, overlay: ClientRect, viewport: ClientRect): Point {
    const overflowRight = Math.max(point.x + overlay.width - viewport.right, 0);
    const overflowBottom = Math.max(point.y + overlay.height - viewport.bottom, 0);
    const overflowTop = Math.max(viewport.top - point.y, 0);
    const overflowLeft = Math.max(viewport.left - point.x, 0);

    // Amount by which to push the overlay in each direction such that it remains on-screen.
    let pushX, pushY = 0;

    // If the overlay fits completely within the bounds of the viewport, push it from whichever
    // direction is goes off-screen. Otherwise, push the top-left corner such that its in the
    // viewport and allow for the trailing end of the overlay to go out of bounds.
    if (overlay.width <= viewport.width) {
      pushX = overflowLeft || -overflowRight;
    } else {
      pushX = viewport.left - point.x;
    }

    if (overlay.height <= viewport.height) {
      pushY = overflowTop || -overflowBottom;
    } else {
      pushY = viewport.top - point.y;
    }

    return {
      x: point.x + pushX,
      y: point.y + pushY,
    };
  }

  /**
   * Applies a computed position to the overlay and emits a position change.
   *
   * @param element The overlay element
   * @param position The position preference
   * @param originPoint The point on the origin element where the overlay is connected.
   * @param viewport The geometry of the viewport.
   */
  private _applyPosition(
      element: HTMLElement,
      position: ConnectionPositionPair,
      originPoint: Point,
      viewport: ClientRect) {
    this._setOverlayElementStyles(position);
    this._setBoundingBoxStyles(originPoint, position, viewport);

    // Save the last connected position in case the position needs to be re-calculated.
    this._lastConnectedPosition = position;

    // Notify that the position has been changed along with its change properties.
    const scrollableViewProperties = this.getScrollableViewProperties(element);
    const positionChange = new ConnectedOverlayPositionChange(position, scrollableViewProperties);
    this._onPositionChange.next(positionChange);
  }

  /**
   * Gets the position and size of the overlay's sizing container.
   *
   * This method does no measuring and applies no styles so that we can cheaply compute the
   * bounds for all positions and choose the best fit based on these results.
   */
  private _calculateBoundingBoxRect(
      origin: Point, position: ConnectedPosition, viewport: ClientRect): BoundingBoxRect {
    let height, top;

    if (position.overlayY === 'top') {
      // Overlay is opening "downward" and thus is bound by the bottom viewport edge.
      top = origin.y;
      height = viewport.bottom - origin.y;
    } else if (position.overlayY === 'bottom') {
      // Overlay is opening "upward" and thus is bound by the top viewport edge.
      top = viewport.top;
      height = origin.y - viewport.top;
    } else {
      // If neither top nor bottom, the overlay is vertically centered on the origin point.
      // todo: more comment
      const smallestDistanceToViewportEdge =
          Math.min(viewport.bottom - origin.y, origin.y - viewport.left);

      height = smallestDistanceToViewportEdge * 2;
      top = origin.y - smallestDistanceToViewportEdge;
    }

    // I.e., overlay is opening "right-ward"
    const isBoundedByRightViewportEdge =
        (position.overlayX === 'start' && !this._isRtl()) ||
        (position.overlayX === 'end' && this._isRtl());

    // I.e., overlay is opening "left-ward"
    const isBoundedByLeftViewportEdge =
        (position.overlayX === 'end' && !this._isRtl()) ||
        (position.overlayX === 'start' && this._isRtl());

    let width, left;

    if (isBoundedByLeftViewportEdge) {
      left = viewport.left;
      width = origin.x - viewport.left;
    } else if (isBoundedByRightViewportEdge) {
      left = origin.x;
      width = viewport.right - origin.x;
    } else {
      // If neither start nor end, the overlay is horizontally centered on the origin point.
      // todo: more comment
      const smallestDistanceToViewportEdge =
          Math.min(viewport.right - origin.x, origin.x - viewport.top);
      width = smallestDistanceToViewportEdge * 2;
      left = origin.x - smallestDistanceToViewportEdge;
    }

    return {top, left, width, height};
  }

  /**
   * Sets the position and size of the overlay's sizing wrapper. The wrapper is positioned on the
   * origin's connection point and stetches to the bounds of the viewport.
   *
   * @param origin The point on the origin element where the overlay is connected.
   * @param position The position preference
   * @param viewport The geometry of the viewport.
   */
  private _setBoundingBoxStyles(
      origin: Point,
      position: ConnectedPosition,
      viewport: ClientRect): void {

    const boundingBoxRect = this._calculateBoundingBoxRect(origin, position, viewport);

    const styles = {
      top: `${boundingBoxRect.top}px`,
      left: `${boundingBoxRect.left}px`,
      width: `${boundingBoxRect.width}px`,
      height: `${boundingBoxRect.height}px`,
    } as CSSStyleDeclaration;

    extendObject(this._boundingBox.style, styles);
  }

  /** Sets positioning styles to the overlay element. */
  private _setOverlayElementStyles(position: ConnectedPosition): void {
    // Reset styles from any previous positioning.
    const style = {
      top: '',
      left: '',
      bottom: '',
      right: '',
    } as CSSStyleDeclaration;

    // Align the overlay panel to the appropriate edge of the size-constraining container unless
    // using a 'center' position.
    if (position.overlayX !== 'center') {
      style[position.overlayX === 'end' ? 'right' : 'left'] = '0';
    }

    if (position.overlayY !== 'center') {
      style[position.overlayY === 'bottom' ? 'bottom' : 'top'] = '0';
    }

    // Use a negative margin to apply the position's offset. We do this because the `center`
    // positions rely on being in the normal flex flow and setting a `top` / `left` at all will
    // completely throw off the position.
    if (position.offsetX) {
      style[position.offsetX < 0 ? 'margin-left' : 'margin-right'] = -Math.abs(position.offsetX);
    }

    if (position.offsetY) {
      style[position.offsetY < 0 ? 'margin-top' : 'margin-bottom'] = -Math.abs(position.offsetY);
    }

    extendObject(this._pane.style, style);
  }

  /**
   * Gets the view properties of the trigger and overlay, including whether they are clipped
   * or completely outside the view of any of the strategy's scrollables.
   */
  private getScrollableViewProperties(overlay: HTMLElement): ScrollableViewProperties {
    const originBounds = this._getElementBounds(this._origin);
    const overlayBounds = this._getElementBounds(overlay);
    const scrollContainerBounds = this.scrollables.map((scrollable: Scrollable) => {
      return this._getElementBounds(scrollable.getElementRef().nativeElement);
    });

    return {
      isOriginClipped: this.isElementClipped(originBounds, scrollContainerBounds),
      isOriginOutsideView: this.isElementOutsideView(originBounds, scrollContainerBounds),
      isOverlayClipped: this.isElementClipped(overlayBounds, scrollContainerBounds),
      isOverlayOutsideView: this.isElementOutsideView(overlayBounds, scrollContainerBounds),
    };
  }

  /** Whether the element is completely out of the view of any of the containers. */
  private isElementOutsideView(
      elementBounds: ElementBoundingPositions,
      containersBounds: ElementBoundingPositions[]): boolean {
    return containersBounds.some((containerBounds: ElementBoundingPositions) => {
      const outsideAbove = elementBounds.bottom < containerBounds.top;
      const outsideBelow = elementBounds.top > containerBounds.bottom;
      const outsideLeft = elementBounds.right < containerBounds.left;
      const outsideRight = elementBounds.left > containerBounds.right;

      return outsideAbove || outsideBelow || outsideLeft || outsideRight;
    });
  }

  /** Whether the element is clipped by any of the containers. */
  private isElementClipped(
      elementBounds: ElementBoundingPositions,
      containersBounds: ElementBoundingPositions[]): boolean {
    return containersBounds.some((containerBounds: ElementBoundingPositions) => {
      const clippedAbove = elementBounds.top < containerBounds.top;
      const clippedBelow = elementBounds.bottom > containerBounds.bottom;
      const clippedLeft = elementBounds.left < containerBounds.left;
      const clippedRight = elementBounds.right > containerBounds.right;

      return clippedAbove || clippedBelow || clippedLeft || clippedRight;
    });
  }

  /** Returns the bounding positions of the provided element with respect to the viewport. */
  private _getElementBounds(element: HTMLElement): ElementBoundingPositions {
    const boundingClientRect = element.getBoundingClientRect();
    return {
      top: boundingClientRect.top,
      right: boundingClientRect.left + boundingClientRect.width,
      bottom: boundingClientRect.top + boundingClientRect.height,
      left: boundingClientRect.left
    };
  }

  /**
   * Subtracts the amount that an element is overflowing on an axis from it's length.
   */
  private _subtractOverflows(length: number, ...overflows: number[]): number {
    return overflows.reduce((currentValue: number, currentOverflow: number) => {
      return currentValue - Math.max(currentOverflow, 0);
    }, length);
  }

  /** Narrows the given viewport rect by the current _viewportMargin. */
  private _narrowViewportRect(rect: ClientRect): ClientRect {
    return {
      top:    rect.top    + this._viewportMargin,
      left:   rect.left   + this._viewportMargin,
      right:  rect.right  - this._viewportMargin,
      bottom: rect.bottom - this._viewportMargin,
      width:  rect.width  - (2 * this._viewportMargin),
      height: rect.height - (2 * this._viewportMargin),
    };
  }

  /**
   * Creates a wrapper element for the overlay to constrain the size of the overlay panel via
   * setting top/bottom/left/right on the wrapper.
   */
  _creatingBoundingBox(): HTMLDivElement {
    const boundingBox = document.createElement('div');
    boundingBox.classList.add('cdk-overlay-connected-pos-bounding-box');
    boundingBox.dir = this._overlayRef.getState().direction || 'ltr';
    return boundingBox;
  }
}

/** A simple (x, y) coordinate. */
interface Point {
  x: number;
  y: number;
}

/** Record of measurements for how an overlay (at a given position) fits into the viewport. */
interface OverlayFit {
  /** Whether the overlay fits completely in the viewport. */
  isCompletelyWithinViewport: boolean;

  /** Whether the overlay fits in the viewport on the y-axis. */
  fitsInViewportVertically: boolean;

  /** Whether the overlay fits in the viewport on the x-axis. */
  fitsInViewportHorizontally: boolean;

  /** The total visible area (in px^2) of the overlay inside the viewport. */
  visibleArea: number;
}

/** Record of the measurments determining whether an overlay will fit in a specific position. */
interface FallbackPosition {
  pos: ConnectedPosition;
  originPoint: Point;
  overlayPoint: Point;
  overlayFit: OverlayFit;
  overlayRect: ClientRect;
}

/** Position and size of the overlay sizing wrapper for a specific position. */
interface BoundingBoxRect {
  top: number;
  left: number;
  height: number;
  width: number;
}

/** Record of measures determining how well a given position will fit with flexible dimensions. */
interface FlexibleFit {
  position: ConnectedPosition;
  origin: Point;
  overlayRect: ClientRect;
  boundingBoxRect: BoundingBoxRect;
}

/** A connected position as specified by the user. */
export interface ConnectedPosition {
  originX: 'start' | 'center' | 'end'
  originY: 'top' | 'center' | 'bottom';

  overlayX: 'start' | 'center' | 'end';
  overlayY: 'top' | 'center' | 'bottom';

  weight?: number;
  offsetX?: number;
  offsetY?: number;
}
