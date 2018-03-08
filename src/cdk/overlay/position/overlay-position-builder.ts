/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ViewportRuler} from '@angular/cdk/scrolling';
import {DOCUMENT} from '@angular/common';
import {APP_ROOT_SCOPE, ElementRef, Inject, Injectable} from '@angular/core';
import {OriginConnectionPosition, OverlayConnectionPosition} from './connected-position';
import {ConnectedPositionStrategy} from './connected-position-strategy';
import {GlobalPositionStrategy} from './global-position-strategy';


/** Builder for overlay position strategy. */
@Injectable({scope: APP_ROOT_SCOPE})
export class OverlayPositionBuilder {
  constructor(private _viewportRuler: ViewportRuler,
              @Inject(DOCUMENT) private _document: any) { }

  /**
   * Creates a global position strategy.
   */
  global(): GlobalPositionStrategy {
    return new GlobalPositionStrategy(this._document);
  }

  /**
   * Creates a relative position strategy.
   * @param elementRef
   * @param originPos
   * @param overlayPos
   */
  connectedTo(
      elementRef: ElementRef,
      originPos: OriginConnectionPosition,
      overlayPos: OverlayConnectionPosition): ConnectedPositionStrategy {

    return new ConnectedPositionStrategy(originPos, overlayPos, elementRef,
        this._viewportRuler, this._document);
  }
}
