# Moved

This repository contains the code for "Old SES": the one whose default export is a single object named `SES`, which has a property named `SES.makeSESRootRealm()`. This code was used to make all NPM releases of the `SES` package up through the '0.6.x' series.

Modern SES development is now happening in the [SES-shim](https://github.com/Agoric/ses-shim) repository. This "New SES" has a named export named `lockdown()`, which introduces the `Compartment` constructor (and the `harden` function) into the global environment. That code is used to make NPM releases of `SES` starting with the '0.7.x' series.

The old SES code was used to populate the `packages/ses/` directory in the New SES reposotiry.

Developers who need to make more releases in the '0.6.x' series should use the `0.6-stable` branch of this repository. The trunk is left empty to avoid confusion.
