/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OverlayModule} from '@angular/cdk/overlay';
import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {MatCommonModule, MatRippleModule} from '@angular/material/core';
import {MAT_MENU_DEFAULT_OPTIONS, MatMenu} from './menu-directive';
import {MatMenuItem} from './menu-item';
import {MAT_MENU_SCROLL_STRATEGY_PROVIDER, MatMenuTrigger} from './menu-trigger';


@NgModule({
  imports: [
    OverlayModule,
    CommonModule,
    MatRippleModule,
    MatCommonModule,
  ],
  exports: [MatMenu, MatMenuItem, MatMenuTrigger, MatCommonModule],
  declarations: [MatMenu, MatMenuItem, MatMenuTrigger],
  providers: [
    MAT_MENU_SCROLL_STRATEGY_PROVIDER,
    {
      provide: MAT_MENU_DEFAULT_OPTIONS,
      useValue: {
        overlapTrigger: true,
        xPosition: 'after',
        yPosition: 'below',
      },
    }
  ],
})
export class MatMenuModule {}
