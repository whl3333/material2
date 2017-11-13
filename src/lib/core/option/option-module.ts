import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatRippleModule} from '../ripple/index';
import {MatPseudoCheckboxModule} from '../selection/index';
import {MatOption} from './option';
import {MatOptgroup} from './optgroup';


@NgModule({
  imports: [MatRippleModule, CommonModule, MatPseudoCheckboxModule],
  exports: [MatOption, MatOptgroup],
  declarations: [MatOption, MatOptgroup]
})
export class MatOptionModule {}
