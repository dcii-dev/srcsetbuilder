# Medium Article Draft

Target URL: https://srcsetbuilder.com

**Why Medium:** DA ~95, articles index independently, and you can publish practical front-end/performance content without restrictions.
Use a personal or brand account. If possible, submit to a web performance or front-end engineering publication for distribution.

---

## Article: Your srcset Is Probably Wrong. Here's How to Fix It in 60 Seconds.

**Suggested tags:** Web Performance, Responsive Images, Front-End Development, Core Web Vitals, HTML

---

Most developers ship responsive images with one of two problems:

1. Too few candidates (the browser has no good option for mid-range viewports)
2. A `sizes` attribute that does not match the actual CSS layout

Both waste bandwidth or deliver blurry images. Neither shows up in a build error. You only notice when Lighthouse flags an oversized download or when a client asks why their hero looks soft on a Retina display.

### The Real Job of srcset and sizes

The browser does not pick the smallest file from your srcset. It evaluates each candidate against the rendered display width of the image, which comes entirely from your `sizes` attribute.

If your sizes say `100vw` but the image actually renders at `70vw` on tablets, the browser selects a file that is 30% larger than needed. Multiply that across a page with six images and you have shipped hundreds of unnecessary kilobytes.

### Why a Single Breakpoint Set Does Not Work for Every Image

A full-bleed hero image needs different candidate widths than a product card in a 4-column grid. The hero needs coverage up to 1920px for desktop Retina. The card maxes out around 768px even on the largest screens.

Using the same srcset widths for both means:

- The hero is undersized on high-DPI desktop
- The card downloads candidates it will never use

You need candidate widths matched to each image's role in the layout, and a sizes attribute that reflects the CSS rules governing that element.

### The DPR Problem Nobody Talks About

A 375px iPhone with a 3x display needs `375 * 3 = 1125px` of image data for a full-width hero. If your largest candidate is 1024px, the image renders slightly soft. If your smallest candidate above 1125px is 1920px, you ship 70% more data than needed.

The fix is straightforward: pick candidate widths that land within 1.0x to 1.3x of the needed pixel count for each common device profile. You need a tool that does the DPR math for you across multiple device profiles simultaneously.

[SrcsetBuilder](https://srcsetbuilder.com) includes a DPR Coverage panel that evaluates your candidate widths against five real device profiles (iPhone SE, iPhone 14 Pro, iPad, Laptop 1280, Desktop 1920) and flags any undersized or oversized gaps instantly.

### The Preload Tag Most Developers Forget

For LCP hero images, a correct `<img>` tag is not enough. Browsers discover images late in the parsing waterfall because they wait for CSS and layout before requesting the image.

The fix is a `<link rel="preload">` tag in `<head>` with `imagesrcset` and `imagesizes` attributes that mirror your `<img>` tag exactly. This tells the browser to start downloading the correct candidate immediately, before the HTML parser even reaches the image element.

The catch: the `crossorigin` attribute must match between the preload tag and the img tag, or the browser downloads the image twice.

[SrcsetBuilder](https://srcsetbuilder.com) generates the preload snippet automatically when you set `fetchpriority="high"`, including the correct `crossorigin` attribute if you have one set.

### Width and Height: The CLS Fix That Takes 2 Seconds

If your `<img>` tag does not include explicit `width` and `height` attributes, the browser cannot calculate the aspect ratio before the image loads. The layout shifts when the image arrives.

This is one of the most common Core Web Vitals failures, and the fix is trivial: add the intrinsic pixel dimensions. The browser uses the ratio to reserve space even while the image is still downloading.

### A Complete Workflow in 60 Seconds

1. Enter your base filename and select an extension
2. Pick a preset that matches the image's role (hero, card, sidebar, article, product, thumbnail)
3. Verify the DPR Coverage panel shows "Good" across all device profiles
4. Copy the generated markup directly into your HTML
5. If it is an LCP image, set fetchpriority to "high" and copy the preload snippet into your `<head>`
6. Upload the source image and export all resized candidates as a zip

That is the entire workflow. No signup, no server, no API key. Pure client-side execution.

[SrcsetBuilder](https://srcsetbuilder.com) handles width descriptors, density descriptors, picture tag output with AVIF + WebP sources, and full image export with quality control.

### The Checklist Before You Ship

Before deploying responsive images to production:

- Does your `sizes` attribute match the CSS layout at every breakpoint?
- Does the DPR panel show "Good" for all five device profiles?
- Does your LCP hero use `loading="eager"` and `fetchpriority="high"`?
- Does your `<img>` include `width` and `height` for CLS prevention?
- If using a CDN with CORS headers, does `crossorigin` match on both the preload and the img?

If any of those are wrong, you are either wasting bandwidth or degrading user experience. Both hurt Core Web Vitals scores.

### Summary

Responsive images are not hard. They are precise. The syntax is unforgiving, the DPR math is tedious by hand, and sizes must mirror your actual CSS layout or the browser makes bad decisions.

Use a tool that does the math, validates the coverage, and outputs copy-ready markup: [SrcsetBuilder](https://srcsetbuilder.com).
