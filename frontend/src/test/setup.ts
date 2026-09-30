import '@testing-library/jest-dom/vitest'

// jsdom does not implement native dialog methods. This supplies visibility only;
// browser acceptance verifies top-layer inertness, tab navigation and Escape.
HTMLDialogElement.prototype.showModal = function () { this.open = true }
HTMLDialogElement.prototype.close = function () { this.open = false }
