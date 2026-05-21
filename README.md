# termo

Print text, images, and QR codes to an **MX10** (or any cat-printer-compatible)
thermal printer straight from your browser, over Bluetooth. No app to install,
no account, no server — everything runs on the page itself.

It is a single static `index.html` plus a manifest, a service worker, and two
icons. Drop it on any static host with HTTPS and it works.

## What it does

- **Text** — a small rich-text editor with font, size, bold / italic /
  underline, and alignment. Eleven fonts, from clean mono to pixel and
  handwritten. Text is rendered to a canvas and printed as an image, so the
  chosen font and inline formatting print exactly as previewed.
- **Image** — pick or drag in a file, choose a black & white conversion
  (Floyd–Steinberg, Bayer, dotted, threshold, or none), and print.
- **QR** — generate a QR code from any text or link.
- **Live preview** — a "receipt" that shows what will come out of the printer.
- **Orientation** — portrait (across the paper) or landscape (rotated 90 degrees
  to print along the roll).
- **Print density** and a manual **feed** control.
- **On-printer status panel** — connection state, device name, and battery shown
  as a control display above the printer mouth.

## Supported printers

Anything the underlying SDK supports: `GB01`, `GB02`, `GB03`, `GT01`, `YT01`,
`MX05`, `MX06`, `MX08`, `MX10`, and similar cat-printer-compatible models. They
all print 384 dots (about 58 mm) wide.

## Browser support

termo uses the **Web Bluetooth API**, which is available only in Chromium-based
browsers:

- Works: Chrome, Edge, Opera (desktop and Android).
- Does not work: Safari and Firefox (no Web Bluetooth), and therefore iOS.

Web Bluetooth also requires a **secure context** — the page must be served over
`https://` or from `localhost`. Opening the file directly (`file://`) will not
work.

## Use it

### Run locally

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000 in Chrome
```

`localhost` counts as a secure context, so Bluetooth works without HTTPS.

1. Turn on the printer and make sure it is not already connected in another app
   (the vendor app holds the Bluetooth connection and will block the browser).
2. Tap the status panel on the printer graphic to connect, and pick your device
   in the Bluetooth chooser.
3. Type, pick an image, or enter a link, then press print.

### Install as an app

On Android Chrome, open the site and choose "Add to Home screen". The manifest
and service worker make it launch full-screen like a native app and open offline
after the first load.

## Deploy

It is a static site, so any static host works (GitHub Pages, Cloudflare Pages,
Vercel, Netlify). The only requirement is HTTPS.

GitHub Pages, for example: push this repository, then enable
**Settings -> Pages -> Deploy from a branch -> `main` / root**. All paths are
relative, so it also works from a project subpath such as
`https://<user>.github.io/<repo>/`.

Note: the printing SDK and the QR library are loaded from a CDN
(jsDelivr), so the **first** load needs an internet connection. After that the
app shell is cached by the service worker.

## How it works

- Connection and printing go through the
  [`@opuu/cat-printer`](https://github.com/opuu/cat-printer) Web Bluetooth SDK.
- Printing is driven row by row with explicit flow control
  (`writeValueWithResponse` where available, otherwise a small inter-row delay).
  This avoids the dropped rows that otherwise truncate long images, and every
  row — including blank ones — is sent so spacing and QR quiet zones survive.
- Density is applied per print, and a short paper feed is issued at the end so
  the last line clears the print head.

## Privacy

Everything happens in the browser. There is no backend, no account, and no
analytics. Text and images never leave the device — they go straight to the
printer over Bluetooth.

## Limitations

- **Battery percentage** is shown only if the printer exposes the standard BLE
  Battery Service. Most of these printers do not, so the panel falls back to an
  "ok / low" indicator from the device status flag.
- **Auto-reconnect** after a page reload is intentionally not implemented:
  persistent Web Bluetooth permissions are inconsistent across browsers, so you
  reconnect manually.

## Credits

- [`@opuu/cat-printer`](https://github.com/opuu/cat-printer) — Web Bluetooth SDK
  for cat printers.
- [`qrcode`](https://github.com/soldair/node-qrcode) — QR code generation.
- Inspired by [NaitLee/Cat-Printer](https://github.com/NaitLee/Cat-Printer).

## License

MIT — see [LICENSE](LICENSE).
