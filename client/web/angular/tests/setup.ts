/**
 * TestBed needs a platform before it can build one.
 *
 * The import of `@angular/compiler` is not decorative: without it, TestBed has
 * no JIT compiler and the first component it tries to build fails with a
 * message about AOT.
 */
import '@angular/compiler'

import { getTestBed } from '@angular/core/testing'
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing'

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting())
