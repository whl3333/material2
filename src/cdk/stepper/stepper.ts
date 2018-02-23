/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {
  ContentChildren,
  EventEmitter,
  Input,
  Output,
  QueryList,
  Directive,
  ElementRef,
  Component,
  ContentChild,
  ViewChild,
  TemplateRef,
  ViewEncapsulation,
  Optional,
  Inject,
  forwardRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnChanges,
  OnDestroy
} from '@angular/core';
import {
  LEFT_ARROW,
  RIGHT_ARROW,
  DOWN_ARROW,
  UP_ARROW,
  ENTER,
  SPACE,
  HOME,
  END,
} from '@angular/cdk/keycodes';
import {CdkStepLabel} from './step-label';
import {coerceBooleanProperty} from '@angular/cdk/coercion';
import {AbstractControl} from '@angular/forms';
import {Direction, Directionality} from '@angular/cdk/bidi';
import {Subject} from 'rxjs/Subject';

/** Used to generate unique ID for each stepper component. */
let nextId = 0;

/**
 * Position state of the content of each step in stepper that is used for transitioning
 * the content into correct position upon step selection change.
 */
export type StepContentPositionState = 'previous' | 'current' | 'next';

/** Possible orientation of a stepper. */
export type StepperOrientation = 'horizontal' | 'vertical';

/** Change event emitted on selection changes. */
export class StepperSelectionEvent {
  /** Index of the step now selected. */
  selectedIndex: number;

  /** Index of the step previously selected. */
  previouslySelectedIndex: number;

  /** The step instance now selected. */
  selectedStep: CdkStep;

  /** The step instance previously selected. */
  previouslySelectedStep: CdkStep;
}

@Component({
  moduleId: module.id,
  selector: 'cdk-step',
  exportAs: 'cdkStep',
  template: '<ng-template><ng-content></ng-content></ng-template>',
  encapsulation: ViewEncapsulation.None,
  preserveWhitespaces: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CdkStep implements OnChanges {
  /** Template for step label if it exists. */
  @ContentChild(CdkStepLabel) stepLabel: CdkStepLabel;

  /** Template for step content. */
  @ViewChild(TemplateRef) content: TemplateRef<any>;

  /** The top level abstract control of the step. */
  @Input() stepControl: AbstractControl;

  /** Whether user has seen the expanded step content or not. */
  interacted = false;

  /** Label of the step. */
  @Input() label: string;

  /** Whether the user can return to this step once it has been marked as complted. */
  @Input()
  get editable(): boolean { return this._editable; }
  set editable(value: boolean) {
    this._editable = coerceBooleanProperty(value);
  }
  private _editable = true;

  /** Whether the completion of step is optional. */
  @Input()
  get optional(): boolean { return this._optional; }
  set optional(value: boolean) {
    this._optional = coerceBooleanProperty(value);
  }
  private _optional = false;

  /** Whether step is marked as completed. */
  @Input()
  get completed(): boolean {
    return this._customCompleted == null ? this._defaultCompleted : this._customCompleted;
  }
  set completed(value: boolean) {
    this._customCompleted = coerceBooleanProperty(value);
  }
  private _customCompleted: boolean | null = null;

  private get _defaultCompleted() {
    return this.stepControl ? this.stepControl.valid && this.interacted : this.interacted;
  }

  constructor(@Inject(forwardRef(() => CdkStepper)) private _stepper: CdkStepper) { }

  /** Selects this step component. */
  select(): void {
    this._stepper.selected = this;
  }

  /** Resets the step to its initial state. Note that this includes resetting form data. */
  reset(): void {
    this.interacted = false;

    if (this._customCompleted != null) {
      this._customCompleted = false;
    }

    if (this.stepControl) {
      this.stepControl.reset();
    }
  }

  ngOnChanges() {
    // Since basically all inputs of the MatStep get proxied through the view down to the
    // underlying MatStepHeader, we have to make sure that change detection runs correctly.
    this._stepper._stateChanged();
  }
}

@Directive({
  selector: '[cdkStepper]',
  exportAs: 'cdkStepper',
})
export class CdkStepper implements OnDestroy {
  /** Emits when the component is destroyed. */
  protected _destroyed = new Subject<void>();

  /** The list of step components that the stepper is holding. */
  @ContentChildren(CdkStep) _steps: QueryList<CdkStep>;

  /** The list of step headers of the steps in the stepper. */
  _stepHeader: QueryList<ElementRef>;

  /** Whether the validity of previous steps should be checked or not. */
  @Input()
  get linear(): boolean { return this._linear; }
  set linear(value: boolean) { this._linear = coerceBooleanProperty(value); }
  private _linear = false;

  /** The index of the selected step. */
  @Input()
  get selectedIndex() { return this._selectedIndex; }
  set selectedIndex(index: number) {
    if (this._steps) {
      // Ensure that the index can't be out of bounds.
      if (index < 0 || index > this._steps.length - 1) {
        throw Error('cdkStepper: Cannot assign out-of-bounds value to `selectedIndex`.');
      }

      if (this._anyControlsInvalidOrPending(index) || index < this._selectedIndex &&
          !this._steps.toArray()[index].editable) {
        // remove focus from clicked step header if the step is not able to be selected
        this._stepHeader.toArray()[index].nativeElement.blur();
      } else if (this._selectedIndex != index) {
        this._emitStepperSelectionEvent(index);
        this._focusIndex = this._selectedIndex;
      }
    } else {
      this._selectedIndex = this._focusIndex = index;
    }
  }
  private _selectedIndex = 0;

  /** The step that is selected. */
  @Input()
  get selected(): CdkStep { return this._steps.toArray()[this.selectedIndex]; }
  set selected(step: CdkStep) {
    this.selectedIndex = this._steps.toArray().indexOf(step);
  }

  /** Event emitted when the selected step has changed. */
  @Output() selectionChange: EventEmitter<StepperSelectionEvent>
      = new EventEmitter<StepperSelectionEvent>();

  /** The index of the step that the focus can be set. */
  _focusIndex: number = 0;

  /** Used to track unique ID for each stepper component. */
  _groupId: number;

  protected _orientation: StepperOrientation = 'horizontal';

  constructor(
    @Optional() private _dir: Directionality,
    private _changeDetectorRef: ChangeDetectorRef) {
    this._groupId = nextId++;
  }

  ngOnDestroy() {
    this._destroyed.next();
    this._destroyed.complete();
  }

  /** Selects and focuses the next step in list. */
  next(): void {
    this.selectedIndex = Math.min(this._selectedIndex + 1, this._steps.length - 1);
  }

  /** Selects and focuses the previous step in list. */
  previous(): void {
    this.selectedIndex = Math.max(this._selectedIndex - 1, 0);
  }

  /** Resets the stepper to its initial state. Note that this includes clearing form data. */
  reset(): void {
    this.selectedIndex = 0;
    this._steps.forEach(step => step.reset());
    this._stateChanged();
  }

  /** Returns a unique id for each step label element. */
  _getStepLabelId(i: number): string {
    return `cdk-step-label-${this._groupId}-${i}`;
  }

  /** Returns unique id for each step content element. */
  _getStepContentId(i: number): string {
    return `cdk-step-content-${this._groupId}-${i}`;
  }

  /** Marks the component to be change detected. */
  _stateChanged() {
    this._changeDetectorRef.markForCheck();
  }

  /** Returns position state of the step with the given index. */
  _getAnimationDirection(index: number): StepContentPositionState {
    const position = index - this._selectedIndex;
    if (position < 0) {
      return this._layoutDirection() === 'rtl' ? 'next' : 'previous';
    } else if (position > 0) {
      return this._layoutDirection() === 'rtl' ? 'previous' : 'next';
    }
    return 'current';
  }

  /** Returns the type of icon to be displayed. */
  _getIndicatorType(index: number): 'number' | 'edit' | 'done' {
    const step = this._steps.toArray()[index];
    if (!step.completed || this._selectedIndex == index) {
      return 'number';
    } else {
      return step.editable ? 'edit' : 'done';
    }
  }

  private _emitStepperSelectionEvent(newIndex: number): void {
    const stepsArray = this._steps.toArray();
    this.selectionChange.emit({
      selectedIndex: newIndex,
      previouslySelectedIndex: this._selectedIndex,
      selectedStep: stepsArray[newIndex],
      previouslySelectedStep: stepsArray[this._selectedIndex],
    });
    this._selectedIndex = newIndex;
    this._stateChanged();
  }

  _onKeydown(event: KeyboardEvent) {
    const keyCode = event.keyCode;

    // Note that the left/right arrows work both in vertical and horizontal mode.
    if (keyCode === RIGHT_ARROW) {
      this._layoutDirection() === 'rtl' ? this._focusPreviousStep() : this._focusNextStep();
      event.preventDefault();
    }

    if (keyCode === LEFT_ARROW) {
      this._layoutDirection() === 'rtl' ? this._focusNextStep() : this._focusPreviousStep();
      event.preventDefault();
    }

    // Note that the up/down arrows only work in vertical mode.
    // See: https://www.w3.org/TR/wai-aria-practices-1.1/#tabpanel
    if (this._orientation === 'vertical' && (keyCode === UP_ARROW || keyCode === DOWN_ARROW)) {
      keyCode === UP_ARROW ? this._focusPreviousStep() : this._focusNextStep();
      event.preventDefault();
    }

    if (keyCode === SPACE || keyCode === ENTER) {
      this.selectedIndex = this._focusIndex;
      event.preventDefault();
    }

    if (keyCode === HOME) {
      this._focusStep(0);
      event.preventDefault();
    }

    if (keyCode === END) {
      this._focusStep(this._steps.length - 1);
      event.preventDefault();
    }
  }

  private _focusNextStep() {
    this._focusStep((this._focusIndex + 1) % this._steps.length);
  }

  private _focusPreviousStep() {
    this._focusStep((this._focusIndex + this._steps.length - 1) % this._steps.length);
  }

  private _focusStep(index: number) {
    this._focusIndex = index;
    this._stepHeader.toArray()[this._focusIndex].nativeElement.focus();
  }

  private _anyControlsInvalidOrPending(index: number): boolean {
    const steps = this._steps.toArray();

    steps[this._selectedIndex].interacted = true;

    if (this._linear && index >= 0) {
      return steps.slice(0, index).some(step => {
        const control = step.stepControl;
        const isIncomplete = control ? (control.invalid || control.pending) : !step.completed;
        return isIncomplete && !step.optional;
      });
    }

    return false;
  }

  private _layoutDirection(): Direction {
    return this._dir && this._dir.value === 'rtl' ? 'rtl' : 'ltr';
  }
}
