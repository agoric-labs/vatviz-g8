# vatViz - show vat connectivity evolving over cranks

> The Agoric SwingSet is the basis for development with the Agoric SDK, a development kit for writing smart contracts
> in a secure, hardened version of JavaScript. Smart contracts built with the Agoric SDK have mediated asynchronous
> communication, and messages can only be sent along references according to the rules of the Object Capabilities
> model that the SwingSet implements. -- [Agoric Swingset Kernel and Userspace report ](https://agoric.com/wp-content/uploads/2021/11/informal-agoric-report-phase1.pdf)

## Which vats have access to what capabilities?

[boot1.slog](https://github.com/agoric-labs/vatviz-g8/issues/1) is a [SLOGFILE](https://github.com/Agoric/agoric-sdk/blob/master/docs/env.md#slogfile) that records the bootstrap of an Agoric chain. As messages
are delivered to vats, capabilities are exchanged. At the end of bootstrap,
we can see which vats have access to which capabilities... especially powerful capabilities such a the right to mint IST.

## Example output diagram

See [example output](https://github.com/agoric-labs/vatviz-g8/issues/2#issuecomment-1292737859).

## Video walkthru

See the 1st 11 minutes of [Nov 2 office hours](https://agoric.zoom.us/rec/play/qu8ul0vnLrglvabwAXqEBF6mZme1fLgz3vsxPfPl1KBkKnc3JgObX3958QLNuAgmXrHYHen20vohztis.0kejHVJ-kD6_Xxjw?continueMode=true&_x_zm_rtaid=hCit8lgXT_61bBMMIzpieQ.1667412857809.dcb6b3eab2c982e17fb55ca2eb1f67f2&_x_zm_rhtaid=65)
Passcode: `9c91eg#4`.

## Quick Start

Download the [boot1.slog](https://github.com/agoric-labs/vatviz-g8/issues/1) example. Then:

```sh
git clone https://github.com/agoric-labs/vatviz-g8
cd vatviz-g8
yarn
yarn dev
```

Once it's running,

1. visit http://0.0.0.0:8000
2. hit **Choose File**
3. Choose `boot1.slog`
4. Click "Show" and use arrow keys to move forward thru cranks
5. Move the slider all the way to the right to show the conclusion of bootstrap.
