/**
 * How it works → About: what FloorPlan3D is, what is new in it and what is not, what it cannot do
 * yet, the papers and methods it builds on, and the data and licences behind it. Claims here are
 * kept to what the app and the Results page show.
 */

import React from 'react';
import results from '../data/evaluationResults.json';
import { hrefOf } from '../router';
import { PageHeader } from './ui';

const REPOSITORY = 'https://github.com/saki-28/Floor_Plan_3D_Vizualizer';
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

interface Reference {
  authors: string;
  year: number;
  title: string;
  venue: string;
  doi?: string;
  /** What we take from it. */
  use: string;
}

const PLAN_PAPERS: Reference[] = [
  {
    authors: 'Cambeiro Barreiro, A., Trzeciakiewicz, M., Hilsmann, A. & Eisert, P.',
    year: 2023,
    title: 'Automatic Reconstruction of Semantic 3D Models from 2D Floor Plans',
    venue: '18th International Conference on Machine Vision Applications (MVA), Hamamatsu',
    use: 'Plan image to semantic 3D model with a trained network; we score walls the way it does, by pixel IoU.',
  },
  {
    authors: 'Cheng, X. et al.',
    year: 2022,
    title: 'Multi-stage Floor Plan Recognition and 3D Reconstruction',
    venue: 'ICCAI ’22, Tianjin, ACM',
    doi: '10.1145/3532213.3532271',
    use: 'Recognition in stages, then reconstruction: the overall shape of our pipeline.',
  },
  {
    authors: 'Xiang, B., Wu, C., Zhang, Z., Zhou, S., Gao, R. & Wang, W.',
    year: 2025,
    title: 'A Comprehensive Survey of Floor Plan Recognition: From Traditional Techniques to Deep Learning Approaches',
    venue: 'International Conference on Machine Learning and Neural Networks (MLNN), ACM',
    doi: '10.1145/3747227.3747250',
    use: 'Survey of rule-based and learned methods; why we compare the two.',
  },
  {
    authors: 'Chhabra, P. et al.',
    year: 2025,
    title: 'End-to-End 2D Floor Plan to 3D Conversion Framework',
    venue: 'IEEE Madhya Pradesh Section Conference (MPCON)',
    doi: '10.1109/MPCON66082.2025.11256647',
    use: 'A recent end-to-end plan-to-3D system.',
  },
  {
    authors: 'Auliaramadani, M. et al.',
    year: 2020,
    title: 'Augmented Reality for 3D House Design Visualization from Floorplan Image',
    venue: 'International Conference on Electrical Engineering and Informatics (ICELTICs), IEEE',
    doi: '10.1109/ICELTICS50595.2020.9315422',
    use: 'From a floor plan image to a 3D house viewed in augmented reality.',
  },
  {
    authors: 'Zhang, X. et al.',
    year: 2021,
    title: '3D Reconstruction of Weak Feature Indoor Scenes Based on Hector SLAM and Floorplan Generation',
    venue: 'IEEE 7th International Conference on Virtual Reality (ICVR)',
    doi: '10.1109/ICVR51878.2021.9483856',
    use: 'Floor plans generated from SLAM scans, used to rebuild indoor scenes in 3D.',
  },
];

const METHOD_PAPERS: Reference[] = [
  {
    authors: 'Kalervo, A., Ylioinas, J., Häikiö, M., Karhu, A. & Kannala, J.',
    year: 2019,
    title: 'CubiCasa5K: A Dataset and an Improved Multi-Task Model for Floorplan Image Analysis',
    venue: 'Scandinavian Conference on Image Analysis (SCIA)',
    use: 'The 5,000 annotated plans we train and test on.',
  },
  {
    authors: 'Ronneberger, O., Fischer, P. & Brox, T.',
    year: 2015,
    title: 'U-Net: Convolutional Networks for Biomedical Image Segmentation',
    venue: 'MICCAI',
    use: 'The network that labels each pixel as wall, door, window or background.',
  },
  {
    authors: 'Milletari, F., Navab, N. & Ahmadi, S.-A.',
    year: 2016,
    title: 'V-Net: Fully Convolutional Neural Networks for Volumetric Medical Image Segmentation',
    venue: '3DV',
    use: 'The soft Dice loss, so thin walls and small doors count.',
  },
  { authors: 'Otsu, N.', year: 1979, title: 'A Threshold Selection Method from Gray-Level Histograms', venue: 'IEEE Transactions on Systems, Man, and Cybernetics 9(1)', use: 'Pipeline step 3.' },
  { authors: 'Zuiderveld, K.', year: 1994, title: 'Contrast Limited Adaptive Histogram Equalization', venue: 'Graphics Gems IV, Academic Press', use: 'Pipeline step 2.' },
  { authors: 'Canny, J.', year: 1986, title: 'A Computational Approach to Edge Detection', venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence 8(6)', use: 'Pipeline step 5.' },
  {
    authors: 'Matas, J., Galambos, C. & Kittler, J.',
    year: 2000,
    title: 'Robust Detection of Lines Using the Progressive Probabilistic Hough Transform',
    venue: 'Computer Vision and Image Understanding 78(1)',
    use: 'Pipeline step 6.',
  },
  { authors: 'Bresenham, J. E.', year: 1965, title: 'Algorithm for Computer Control of a Digital Plotter', venue: 'IBM Systems Journal 4(1)', use: 'Line drawing on the Graphics page.' },
];

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section aria-labelledby={id} className="grid grid-cols-1 gap-4 border-t border-line pt-8 lg:grid-cols-[220px_minmax(0,1fr)]">
    <h2 id={id} className="text-[18px] font-semibold leading-6">
      {title}
    </h2>
    <div className="flex max-w-3xl flex-col gap-3 text-[14px] leading-6">{children}</div>
  </section>
);

const Link: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} className="font-medium text-ink underline underline-offset-2 hover:text-accent">
    {children}
  </a>
);

const References: React.FC<{ items: Reference[] }> = ({ items }) => (
  <ol className="flex flex-col gap-3">
    {items.map((ref) => (
      <li key={ref.title} className="text-[13px] leading-5">
        <span className="text-ink">
          {ref.authors} ({ref.year}). <cite className="not-italic font-medium">{ref.title}</cite>. {ref.venue}.
        </span>
        {ref.doi && (
          <>
            {' '}
            <a href={`https://doi.org/${ref.doi}`} className="text-muted underline underline-offset-2 hover:text-ink" target="_blank" rel="noreferrer">
              doi:{ref.doi}
            </a>
          </>
        )}
        <span className="block text-muted">{ref.use}</span>
      </li>
    ))}
  </ol>
);

export const AboutPage: React.FC = () => (
  <div className="flex flex-col gap-8">
    <PageHeader title="About" description="What FloorPlan3D is, what is new in it and what is not, what it cannot do yet, and the work it builds on." />

    <Section id="about-what" title="What it is">
      <p>
        FloorPlan3D turns a floor plan into a 3D model you can walk around, in the browser. Start from a sample, an image of a plan or a blank page; fix the
        walls, doors and windows in <Link href={hrefOf('edit')}>Edit plan</Link>, with every change undoable; then view, measure and export the model in the{' '}
        <Link href={hrefOf('viewer3d')}>3D viewer</Link>.
      </p>
      <p>
        Everything runs on your computer. The image steps use OpenCV.js, the 3D is drawn with WebGL, and your images and plans are never sent anywhere. A plan
        is saved in this browser as you work, and can be saved to and opened from a file.
      </p>
    </Section>

    <Section id="about-new" title="What is new, and what is not">
      <p>
        Turning a plan image into a 3D model is not new: research systems such as Cambeiro Barreiro et al. (2023) and Cheng et al. (2022) do it, and so do
        several commercial tools. What this project adds is smaller and, we think, useful for learning and for trust:
      </p>
      <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted">
        <li>
          <strong className="font-semibold">You can see every step.</strong> The <Link href={hrefOf('pipeline')}>Pipeline</Link> page runs the steps on your
          own image and shows each one’s picture, formula, settings and numbers. Results breaks down where the wrong wall pixels come from.
        </li>
        <li>
          <strong className="font-semibold">A fair comparison of rules and learning.</strong> Hand-written rules and a trained network are scored on the same{' '}
          {results.plans} test plans with the same scorer: {pct(results.rules.meanIoU)} against {pct(results.model.meanIoU)} wall IoU (
          <Link href={hrefOf('results')}>Results</Link>). It is one run, not a benchmark claim.
        </li>
        <li>
          <strong className="font-semibold">A person stays in the loop.</strong> Detection is never the last word: walls, doors and windows can be fixed in Edit
          plan, and the 3D follows at once. Running the trained model in the browser, so detection and fixing happen in one place, is the next step.
        </li>
      </ul>
    </Section>

    <Section id="about-limits" title="What it cannot do yet">
      <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted">
        <li>Walls must be horizontal or vertical. Slanted walls are set aside and curved walls are not handled.</li>
        <li>Image to plan uses the rules, which do best on clean drawings with solid walls. The trained model is not in the app yet.</li>
        <li>Doors and windows are not found in images yet; add them in Edit plan.</li>
        <li>An uploaded image’s scale is guessed from its wall thickness, until there is a step to set it from a known length.</li>
        <li>Rooms and floors cannot be drawn yet, and a plan has one storey. Several storeys are planned.</li>
      </ul>
      <p className="text-muted">
        Progress on each of these is on <Link href={hrefOf('status')}>Project status</Link>.
      </p>
    </Section>

    <Section id="about-papers" title="Floor plans to 3D">
      <References items={PLAN_PAPERS} />
    </Section>

    <Section id="about-methods" title="Data and methods">
      <References items={METHOD_PAPERS} />
    </Section>

    <Section id="about-licences" title="Data and licences">
      <p>
        CubiCasa5k is licensed CC BY-NC-SA 4.0: it may be used for non-commercial work only, and so may a model trained on it. We use it to train and to test.
        None of its images, plans or our model’s weights are part of this app or its code; the Results page shows scores only.
      </p>
      <p>The test plans in Image to plan are drawn by our own code (scripts/generate-test-plans.ts), with their true walls known, so they can be shared freely.</p>
      <p className="text-muted">Built with React, TypeScript and Vite; OpenCV.js (Apache 2.0) for images; KaTeX (MIT) for formulas; PyTorch on Kaggle for training.</p>
    </Section>

    <Section id="about-code" title="Code">
      <p>
        The code is on{' '}
        <a href={REPOSITORY} className="font-medium text-ink underline underline-offset-2 hover:text-accent" target="_blank" rel="noreferrer">
          GitHub
        </a>
        . The original plan for a C++ desktop version and its unfinished code are kept in the repository’s docs folder, not in the app.
      </p>
    </Section>
  </div>
);
