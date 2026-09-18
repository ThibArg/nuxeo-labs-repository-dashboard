/**
 * Global test setup.
 *
 * jsdom implements neither ResizeObserver, which the chart directive observes on init, nor the
 * modal behaviour of `<dialog>`. Chart painting itself is never exercised in tests:
 * `ChartWidgetStubComponent` replaces the real chart in component tests, and the option building
 * logic is unit tested as a pure function.
 */

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  // Enough of the real behaviour for tests: the `open` property and the `close` event.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ): void {
    this.open = false;
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    this.dispatchEvent(new Event('close'));
  };
}
