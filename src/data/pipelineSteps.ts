/**
 * The words and the mathematics of How it works → Pipeline, one entry per step. Each entry says
 * what the step does in plain words, the formula it computes, what the symbols mean and the call
 * that does it, all matching the code in src/vision (pipeline.ts, pipelineParams.ts, vectorize.ts,
 * wallsToPlan.ts). Text between $…$ is typeset as inline maths.
 */

import type { StageId } from '../vision/pipeline';

export type StepId = StageId | 8;

export interface PipelineStep {
  id: StepId;
  title: string;
  /** What the step does and why, in plain words. */
  does: string;
  /** Sub-steps, for the one step that is several operations of our own. */
  parts?: string[];
  /** The formula, in TeX. */
  tex: string;
  /** What the symbols mean; $…$ is inline maths. */
  symbols: string;
  /** The call that does it. */
  code: string;
  /** The method's source, when it is a published one (see About for the full references). */
  source?: string;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 1,
    title: 'Load & resize',
    does:
      'The image is shrunk so its longest side is at most 1,600 pixels. Every size-based setting is a fraction of the long side, so the steps behave the same on a phone photo and on a 300 dpi scan.',
    tex: String.raw`\begin{gathered} s = \min\!\left(1,\ \frac{L_{\max}}{\max(W, H)}\right) \\ W' = \operatorname{round}(sW), \quad H' = \operatorname{round}(sH) \end{gathered}`,
    symbols:
      '$W \\times H$ is the image size and $L_{\\max} = 1600$ px. Shrinking averages the pixels each new pixel covers (area interpolation), so thin lines fade instead of breaking up.',
    code: 'cv.resize(src, dst, new cv.Size(W2, H2), 0, 0, cv.INTER_AREA)',
  },
  {
    id: 2,
    title: 'Grayscale + CLAHE',
    does:
      'Colour is dropped, because walls differ from paper in darkness, not in hue. Then contrast is evened out tile by tile, so a scan that is darker on one side still splits cleanly into ink and paper in the next step.',
    tex: String.raw`\begin{aligned} Y &= 0.299\,R + 0.587\,G + 0.114\,B \\ T_i(v) &= \Bigl\lfloor (L - 1) \sum_{k=0}^{v} \tilde p_i(k) \Bigr\rfloor \end{aligned}`,
    symbols:
      '$Y$ is the grey level. The image is cut into $8 \\times 8$ tiles; $\\tilde p_i$ is tile $i$\'s histogram, clipped at 2 times the mean count with the excess spread over all levels so no level is stretched too far, and $L = 256$. Each pixel blends the maps $T_i$ of its four nearest tiles.',
    code: 'cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)\nnew cv.CLAHE(2.0, new cv.Size(8, 8)).apply(gray, equalized)',
    source: 'Zuiderveld 1994',
  },
  {
    id: 3,
    title: 'Otsu threshold',
    does:
      'Every pixel becomes ink or paper. The cut-off is not a fixed number: Otsu’s method picks the grey level that best splits this image’s histogram into two groups.',
    tex: String.raw`\begin{gathered} t^{*} = \arg\max_{t}\ \omega_0(t)\,\omega_1(t)\,\bigl(\mu_0(t) - \mu_1(t)\bigr)^2 \\ B(x, y) = \begin{cases} 255 & Y(x, y) \le t^{*} \\ 0 & \text{otherwise} \end{cases} \end{gathered}`,
    symbols:
      '$\\omega_0, \\omega_1$ are the shares of pixels at or below and above $t$, and $\\mu_0, \\mu_1$ their mean grey levels. Making the two groups as far apart as possible is the same as making each group as uniform as possible. The result is inverted, so ink is white (255) and paper black.',
    code: 'cv.threshold(equalized, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU)',
    source: 'Otsu 1979',
  },
  {
    id: 4,
    title: 'Clean-up',
    does:
      'Text, dimension ticks, door arcs and specks are removed so that mostly walls are left. An opening erases strokes thinner than its kernel. Then each connected blob of ink is judged by its size, its stroke width and whether it is only a strip along the image edge. Last, a closing bridges small breaks in the walls.',
    tex: String.raw`\begin{gathered} A \circ K = (A \ominus K) \oplus K, \qquad A \bullet K = (A \oplus K) \ominus K \\ r(b) = \max_{p \in b}\ \min_{q \notin A}\ \lVert p - q \rVert_2 \end{gathered}`,
    symbols:
      '$A$ is the ink, $K$ a square kernel, $\\ominus$ erosion and $\\oplus$ dilation. Opening ($\\circ$) removes whatever $K$ does not fit inside; closing ($\\bullet$) fills gaps narrower than $K$. $r(b)$ is blob $b$\'s half stroke width, read from the distance transform. A short blob with $r(b) < 0.35\\, r(\\text{main})$ is text, where main is the largest blob: the wall network. With “Fill outlined walls” on, a closing runs first, so walls drawn as two thin outlines become solid before the opening.',
    code: 'cv.morphologyEx(binary, opened, cv.MORPH_OPEN, kernel)\ncv.connectedComponentsWithStats(opened, labels, stats, centroids, 8, cv.CV_32S)\ncv.distanceTransform(opened, distance, cv.DIST_L2, 3)',
  },
  {
    id: 5,
    title: 'Canny edges',
    does:
      'The outlines of the ink that is left. A wall becomes two parallel edges, one for each face, which is what the next two steps look for.',
    tex: String.raw`\begin{gathered} G = \sqrt{G_x^2 + G_y^2}, \qquad \theta = \operatorname{atan2}(G_y, G_x) \\ T_{\text{high}} = \max(t^{*}, 50), \qquad T_{\text{low}} = \tfrac{1}{2}\, T_{\text{high}} \end{gathered}`,
    symbols:
      '$G_x, G_y$ come from $3 \\times 3$ Sobel filters. A pixel stays only if it is the strongest along its gradient direction $\\theta$. Pixels above $T_{\\text{high}}$ are edges, and pixels above $T_{\\text{low}}$ join them where they connect. Both thresholds come from the Otsu value $t^{*}$ of step 3, so no number here is tuned by hand.',
    code: 'cv.Canny(cleaned, edges, tLow, tHigh, 3, false)',
    source: 'Canny 1986',
  },
  {
    id: 6,
    title: 'Hough segments',
    does:
      'Straight segments are found among the edge pixels. They are not walls yet: one face is often split into several pieces, and every wall has two faces.',
    tex: String.raw`\rho = x \cos\theta + y \sin\theta`,
    symbols:
      'Each edge pixel $(x, y)$ votes for every line $(\\rho, \\theta)$ through it, in steps of 1 px and 1°. The probabilistic version visits pixels in random order and stops counting a line once it is certain, which is far faster. A segment needs enough votes, a minimum length, and no gap longer than the maximum gap. Within ±5° of horizontal or vertical it counts as such; otherwise it is slanted.',
    code: 'cv.HoughLinesP(edges, lines, 1, Math.PI / 180, votes, minLength, maxGap)',
    source: 'Matas, Galambos & Kittler 2000',
  },
  {
    id: 7,
    title: 'Walls',
    does:
      'Segments become walls: a centerline and a thickness. This step is our own code, not an OpenCV call. Slanted segments are set aside, not silently dropped.',
    parts: [
      'Deskew: measure the drawing’s rotation and work in a frame where walls are level.',
      'Snap segments within ±5° to exactly horizontal or vertical.',
      'Merge pieces of one edge that line up and overlap or nearly touch.',
      'Pair two parallel faces a wall’s thickness apart, with ink between them, into one wall.',
      'Join pieces of one wall across short gaps and wherever the centerline is ink all the way.',
      'Grow each end along its centerline while there is ink, so walls reach into corners.',
      'Close corners and T-junctions: an end near a crossing wall extends or trims to it.',
      'Drop lines much thinner than the typical wall, and small groups not joined to the main walls.',
    ],
    tex: String.raw`\begin{gathered} \hat{\varphi} = \operatorname{median}_{\ell}\ \varphi_i \\ c = \tfrac{1}{2}\,(o_1 + o_2), \quad t = \lvert o_1 - o_2 \rvert, \quad t_{\min} \le t \le t_{\max} \end{gathered}`,
    symbols:
      '$\\hat{\\varphi}$ is the drawing’s rotation: the median angle of the near-level segments, weighted by their length $\\ell$. Two parallel faces at offsets $o_1$ and $o_2$ become one wall with its centerline at $c$ and thickness $t$, if $t$ is a plausible wall thickness.',
    code: 'vectorizeWalls(rawSegments, options) // src/vision/vectorize.ts',
  },
  {
    id: 8,
    title: 'Into 3D',
    does:
      'Pixels become metres, and every wall becomes a solid box you can walk around in the 3D viewer, with holes cut where doors and windows are.',
    tex: String.raw`\begin{gathered} x = s\,(u - u_0), \qquad z = s\,(v - v_0) \\ s = \frac{0.2\ \text{m}}{\tilde{t}} \ \text{ if the scale is unknown} \end{gathered}`,
    symbols:
      '$(u, v)$ is a pixel, $(u_0, v_0)$ the centre of the walls’ bounding box, and $s$ the metres per pixel. Image rows grow downwards and so does $z$ in the top view, so nothing is mirrored. The test plans know their scale; for an uploaded image, $s$ is guessed from the median wall thickness $\\tilde{t}$ (in pixels), taken as 0.2 m. Each wall is then raised to 2.8 m (see Graphics).',
    code: 'wallsToPlan(walls, metersPerPixel, { name, width, height }) // src/vision/wallsToPlan.ts',
  },
];
