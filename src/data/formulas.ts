/**
 * Formulas shown on the Results and Graphics pages, in TeX, kept here so a test can check that
 * each one typesets. The Pipeline page's formulas are in pipelineSteps.ts.
 */

export const RESULTS_TEX = {
  scores: String.raw`\begin{gathered} \text{IoU} = \frac{|F \cap T|}{|F \cup T|} \\ \text{precision} = \frac{|F \cap T|}{|F|}, \qquad \text{recall} = \frac{|F \cap T|}{|T|} \end{gathered}`,
  loss: String.raw`\begin{aligned} \mathcal{L} = &-\frac{1}{N}\sum_{i=1}^{N} \log p_{i,\,y_i} \\ &+ \frac{1}{3}\sum_{c} \left(1 - \frac{2\sum_i p_{i,c}\,g_{i,c} + 1}{\sum_i p_{i,c} + \sum_i g_{i,c} + 1}\right) \end{aligned}`,
  lossSymbols:
    '$p_{i,c}$ is the predicted chance that pixel $i$ is class $c$, $y_i$ its true class and $g_{i,c}$ 1 when that is $c$. The Dice term covers wall, door and window; the background is left out because it is most of every plan.',
};

export const GRAPHICS_TEX = {
  bresenhamStart: String.raw`d_0 = 2\,\Delta y - \Delta x`,
  bresenhamStep: String.raw`\begin{aligned} x_{k+1} &= x_k + 1 \\[6pt] \text{if } d_k < 0: \quad y_{k+1} &= y_k \\ d_{k+1} &= d_k + 2\,\Delta y \\[6pt] \text{if } d_k \ge 0: \quad y_{k+1} &= y_k + 1 \\ d_{k+1} &= d_k + 2\,\Delta y - 2\,\Delta x \end{aligned}`,
  bresenhamSymbols:
    'For a line from $(x_0, y_0)$ with $\\Delta x = x_1 - x_0$, $\\Delta y = y_1 - y_0$ and slope $0 \\le \\Delta y / \\Delta x \\le 1$. The sign of $d_k$ says whether the line passes above or below the midpoint between the two candidate pixels, using integers only.',
  view: String.raw`V = \operatorname{lookAt}(\mathbf{e}, \mathbf{t}, \mathbf{u})`,
  clip: String.raw`\mathbf{p}_{\text{clip}} = P\,V\,M\,\mathbf{p}`,
  ndc: String.raw`\mathbf{p}_{\text{ndc}} = \mathbf{p}_{\text{clip}} / w_{\text{clip}} \in [-1, 1]^3`,
  depth: String.raw`\begin{gathered} z_{\text{ndc}} = \frac{f + n}{f - n} + \frac{2fn}{(f - n)\, z_{\text{eye}}} \\ d = \frac{z_{\text{ndc}} + 1}{2} = \frac{f}{f - n}\left(1 - \frac{n}{D}\right) \end{gathered}`,
  depthSymbols:
    '$n$ and $f$ are the near and far planes, $z_{\\text{eye}} < 0$ in front of the camera and $D = -z_{\\text{eye}}$ the distance to it. The depth buffer stores $d$, from 0 at the near plane to 1 at the far plane. It changes fast close to the camera and slowly far away, so precision is spent mostly up close.',
};

/** Distance at which half of the depth buffer's values are used up: d = 1/2 gives D = 2fn / (f + n). */
export const halfDepthDistance = (near: number, far: number) => (2 * far * near) / (far + near);

/** Depth-buffer value at distance D (0 at the near plane, 1 at the far plane). */
export const depthValue = (distance: number, near: number, far: number) => (far / (far - near)) * (1 - near / distance);

/** The smallest change in distance a depth buffer of the given bits can tell apart at distance D. */
export const depthStep = (distance: number, near: number, far: number, bits = 24) =>
  (distance * distance * (far - near)) / (far * near * 2 ** bits);
