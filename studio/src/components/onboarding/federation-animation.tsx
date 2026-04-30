import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Logo } from '../logo';

// --- SVG animation layout ---
const VB_W = 700;
const VB_H = 300;
const CARD_R = 8;
const HEADER_H = 24;
const FIELD_SIZE = 9;
const FIELD_LINE_H = 13;
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const EASE_OUT: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

const PRODUCT_FIELDS = [
  'id: ID!',
  'title: String!',
  'description: String',
  'price: Price!',
  'category: ProductCategory',
];
const REVIEW_FIELDS = [
  'id: ID!',
  'author: String!',
  'email: String',
  'createdOn: Int!',
  'contents: String',
  'rating: Int!',
];
const COMPOSED_PRODUCT_FIELDS = [...PRODUCT_FIELDS, 'reviews: [Review]'];

// Card sizes
const SIDE_W = 190;
const INNER_PAD = 8;
const INNER_HEADER_H = 18;
const INNER_R = 5;
const INNER_FIELDS_H = (fields: string[]) => fields.length * FIELD_LINE_H + 8;
const INNER_H = (fields: string[]) => INNER_HEADER_H + INNER_FIELDS_H(fields);
const OUTER_H = (fields: string[]) => HEADER_H + INNER_PAD + INNER_H(fields) + INNER_PAD;
const PRODUCTS_H = OUTER_H(PRODUCT_FIELDS);
const REVIEWS_H = OUTER_H(REVIEW_FIELDS);
const CENTER_W = 170;
const SUPER_H = OUTER_H(COMPOSED_PRODUCT_FIELDS);

// All cards share the same vertical center for straight horizontal lines
const CENTER_Y = VB_H / 2;

// Positions (products left, supergraph center, reviews right)
const PRODUCTS_X = 15;
const PRODUCTS_Y = CENTER_Y - PRODUCTS_H / 2;
const REVIEWS_X = VB_W - SIDE_W - 15;
const REVIEWS_Y = CENTER_Y - REVIEWS_H / 2;
const SUPER_X = VB_W / 2 - CENTER_W / 2;
const SUPER_Y = CENTER_Y - SUPER_H / 2;

// Straight horizontal lines connecting cards
const LEFT_LINE = `M ${PRODUCTS_X + SIDE_W} ${CENTER_Y} L ${SUPER_X} ${CENTER_Y}`;
const RIGHT_LINE = `M ${SUPER_X + CENTER_W} ${CENTER_Y} L ${REVIEWS_X} ${CENTER_Y}`;

// Expanded supergraph layout (with Review type added below Product)
const REVIEW_INNER_H = INNER_H(REVIEW_FIELDS);
const EXPANDED_SUPER_H = SUPER_H + INNER_PAD + REVIEW_INNER_H;
const EXPANDED_SUPER_Y = Math.max(2, (VB_H - EXPANDED_SUPER_H) / 2);

// Finished animation timing offsets (seconds after isFinished triggers)
const FINISH_TEXT_DURATION = 0.6;
const FINISH_DASH_DELAY = 0.3;
const FINISH_DASH_DURATION = 0.6;
const FINISH_BOX_DELAY = 0.7;
const FINISH_BOX_DURATION = 0.5;
const EXPAND_DELAY = 1.2;
const EXPAND_DURATION = 0.5;

// --- Helpers ---

const ease = (duration: number, delay = 0) => ({ duration, delay, ease: EASE_OUT });

// --- Shared SVG building blocks ---

/** Generates staggered clip paths for a type label + per-field text wipe */
const TypeBoxClipDefs = ({
  prefix,
  fields,
  ix,
  iy,
  iw,
  visible,
  duration,
  baseDelay,
  stagger,
}: {
  prefix: string;
  fields: string[];
  ix: number;
  iy: number;
  iw: number;
  visible: boolean;
  duration: number;
  baseDelay: number;
  stagger: number;
}) => (
  <>
    <clipPath id={`${prefix}-type`}>
      <motion.rect
        x={ix}
        y={iy}
        height={INNER_HEADER_H}
        initial={{ width: 0 }}
        animate={{ width: visible ? iw : 0 }}
        transition={ease(duration, baseDelay + stagger)}
      />
    </clipPath>
    {fields.map((_, i) => (
      <clipPath id={`${prefix}-${i}`} key={i}>
        <motion.rect
          x={ix}
          y={iy + INNER_HEADER_H + 4 + i * FIELD_LINE_H}
          height={FIELD_LINE_H}
          initial={{ width: 0 }}
          animate={{ width: visible ? iw : 0 }}
          transition={ease(duration, baseDelay + (i + 2) * stagger)}
        />
      </clipPath>
    ))}
  </>
);

/** Renders field text lines, each wrapped in its own clip path for staggered wipe */
const ClippedFields = ({
  clipPrefix,
  fields,
  ix,
  iy,
  textOpacity,
  duration,
  delay,
}: {
  clipPrefix: string;
  fields: string[];
  ix: number;
  iy: number;
  textOpacity: number;
  duration: number;
  delay: number;
}) => (
  <>
    {fields.map((field, i) => (
      <g key={field} clipPath={`url(#${clipPrefix}-${i})`}>
        <motion.text
          x={ix + 8}
          y={iy + INNER_HEADER_H + 4 + i * FIELD_LINE_H + FIELD_SIZE}
          fill="hsl(var(--muted-foreground))"
          fontSize={FIELD_SIZE}
          fontFamily={MONO_FONT}
          initial={{ opacity: 0 }}
          animate={{ opacity: textOpacity }}
          transition={{ duration, delay }}
        >
          {field}
        </motion.text>
      </g>
    ))}
  </>
);

// --- Node components ---

const SubgraphNode = ({
  x,
  y,
  w,
  h,
  name,
  typeName,
  fields,
  delay,
  isComposed,
  isFinished,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  typeName: string;
  fields: string[];
  delay: number;
  isComposed: boolean;
  isFinished: boolean;
}) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const contentDelay = delay + 0.35;

  // Inner type box position
  const ix = x + INNER_PAD;
  const iy = y + HEADER_H + INNER_PAD;
  const iw = w - INNER_PAD * 2;
  const ih = INNER_H(fields);
  const clipId = `field-clip-${name}`;

  // Clip timing switches between wipe-in (normal) and wipe-out (finished)
  const clipDuration = isFinished ? FINISH_TEXT_DURATION * 0.6 : 0.4;
  const clipBaseDelay = isFinished ? 0 : delay + 1.0;
  const clipStagger = isFinished ? 0.06 : 0.08;

  return (
    <g>
      <defs>
        {/* Subgraph title clip */}
        <clipPath id={`${clipId}-title`}>
          <motion.rect
            x={x}
            y={y}
            height={HEADER_H}
            initial={{ width: 0 }}
            animate={{ width: isFinished ? 0 : w }}
            transition={isFinished ? ease(FINISH_TEXT_DURATION * 0.6) : ease(0.4, delay + 1.0)}
          />
        </clipPath>
        <TypeBoxClipDefs
          prefix={clipId}
          fields={fields}
          ix={ix}
          iy={iy}
          iw={iw}
          visible={!isFinished}
          duration={clipDuration}
          baseDelay={clipBaseDelay}
          stagger={clipStagger}
        />
      </defs>

      {/* Outer subgraph card — shrinks to center when finished */}
      <motion.rect
        initial={{ x: cx, y: cy, width: 0, height: 0, rx: CARD_R }}
        animate={
          isFinished ? { x: cx, y: cy, width: 0, height: 0, rx: CARD_R } : { x, y, width: w, height: h, rx: CARD_R }
        }
        transition={isFinished ? ease(FINISH_BOX_DURATION, FINISH_BOX_DELAY) : ease(0.5, delay)}
        fill="hsl(var(--card))"
        stroke={isComposed && !isFinished ? 'hsl(var(--muted-foreground))' : 'hsl(var(--border))'}
        strokeWidth={1}
      />

      {/* Subgraph name header — clipped for wipe */}
      <g clipPath={`url(#${clipId}-title)`}>
        <motion.text
          x={x + 10}
          y={y + HEADER_H / 2 + 1}
          dominantBaseline="central"
          fill={isComposed ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'}
          fillOpacity={isComposed ? 1 : 0.6}
          fontSize={10}
          fontWeight={600}
          letterSpacing="0.05em"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: contentDelay }}
        >
          {name}
        </motion.text>
      </g>
      {/* Header separator — expands from center, collapses back on finish */}
      <motion.line
        y1={y + HEADER_H}
        y2={y + HEADER_H}
        stroke={isComposed ? 'hsl(var(--muted-foreground))' : 'hsl(var(--border))'}
        initial={{ x1: x + w / 2, x2: x + w / 2, opacity: 1 }}
        animate={isFinished ? { x1: x + w / 2, x2: x + w / 2 } : { x1: x, x2: x + w }}
        transition={isFinished ? ease(0.3, FINISH_BOX_DELAY) : ease(0.4, delay + 0.8)}
      />
      {/* Inner type box */}
      <motion.rect
        x={ix}
        y={iy}
        width={iw}
        height={ih}
        rx={INNER_R}
        fill="hsl(var(--muted))"
        fillOpacity={0.3}
        stroke="hsl(var(--border))"
        strokeOpacity={0.6}
        strokeWidth={0.75}
        initial={{ opacity: 0 }}
        animate={{ opacity: isFinished ? 0 : 1 }}
        transition={isFinished ? { duration: 0.3, delay: FINISH_BOX_DELAY } : { duration: 0.2, delay: contentDelay }}
      />
      {/* Type name label — clipped for wipe */}
      <g clipPath={`url(#${clipId}-type)`}>
        <motion.text
          x={ix + 8}
          y={iy + INNER_HEADER_H / 2 + 1}
          dominantBaseline="central"
          fill="hsl(var(--muted-foreground))"
          fillOpacity={isComposed ? 0.7 : 0.4}
          fontSize={9}
          fontWeight={600}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: contentDelay }}
        >
          {typeName}
        </motion.text>
      </g>
      {/* Inner header separator */}
      <motion.line
        x1={ix}
        y1={iy + INNER_HEADER_H}
        x2={ix + iw}
        y2={iy + INNER_HEADER_H}
        stroke="hsl(var(--border))"
        strokeOpacity={0.4}
        initial={{ opacity: 0 }}
        animate={{ opacity: isFinished ? 0 : 1 }}
        transition={isFinished ? { duration: 0.3, delay: FINISH_BOX_DELAY } : { duration: 0.2, delay: contentDelay }}
      />

      <ClippedFields
        clipPrefix={clipId}
        fields={fields}
        ix={ix}
        iy={iy}
        textOpacity={isComposed ? 1 : 0.4}
        duration={0.3}
        delay={contentDelay + 0.05}
      />
    </g>
  );
};

const SupergraphNode = ({
  x,
  y,
  w,
  h,
  delay,
  isComposed,
  isFinished,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  isComposed: boolean;
  isFinished: boolean;
}) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const contentDelay = delay + 0.35;

  // Inner Product type box
  const ix = x + INNER_PAD;
  const iy = y + HEADER_H + INNER_PAD;
  const iw = w - INNER_PAD * 2;
  const ih = INNER_H(COMPOSED_PRODUCT_FIELDS);

  // Review type box (below Product, appears on finish)
  const reviewIy = iy + ih + INNER_PAD;
  const reviewIh = REVIEW_INNER_H;
  const reviewCx = ix + iw / 2;
  const reviewCy = reviewIy + reviewIh / 2;
  const reviewContentDelay = EXPAND_DELAY + EXPAND_DURATION;

  // Y shift for the whole group when expanding
  const groupShiftY = EXPANDED_SUPER_Y - y;

  return (
    <motion.g
      animate={{ y: isFinished ? groupShiftY : 0 }}
      transition={isFinished ? ease(EXPAND_DURATION, EXPAND_DELAY) : { duration: 0.3 }}
    >
      {/* Outer box — expands height on finish */}
      <motion.rect
        initial={{ x: cx, y: cy, width: 0, height: 0, rx: CARD_R }}
        animate={{ x, y, width: w, height: isFinished ? EXPANDED_SUPER_H : h, rx: CARD_R }}
        transition={isFinished ? { height: ease(EXPAND_DURATION, EXPAND_DELAY), duration: 0.01 } : ease(0.5, delay)}
        fill="hsl(var(--card))"
        stroke={isComposed ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
        strokeWidth={isComposed ? 1.5 : 1}
      />

      {/* Logo + title — always visible */}
      <motion.foreignObject
        x={x + 6}
        y={y + HEADER_H / 2 - 5}
        width={12}
        height={12}
        initial={{ opacity: 0 }}
        animate={{ opacity: isComposed ? 1 : 0.6 }}
        transition={{ duration: 0.2, delay: delay + 0.35 }}
      >
        <div style={{ color: isComposed ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>
          <Logo width={12} height={12} />
        </div>
      </motion.foreignObject>
      <motion.text
        x={x + 22}
        y={y + HEADER_H / 2 + 1}
        dominantBaseline="central"
        fill={isComposed ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
        fillOpacity={isComposed ? 1 : 0.6}
        fontSize={10}
        fontWeight={600}
        letterSpacing="0.05em"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: delay + 0.35 }}
      >
        supergraph
      </motion.text>

      {/* Header separator */}
      <motion.line
        x1={x}
        y1={y + HEADER_H}
        x2={x + w}
        y2={y + HEADER_H}
        stroke={isComposed ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: contentDelay }}
      />

      {/* Inner Product type box */}
      <motion.rect
        x={ix}
        y={iy}
        width={iw}
        height={ih}
        rx={INNER_R}
        fill="hsl(var(--muted))"
        fillOpacity={0.3}
        stroke="hsl(var(--border))"
        strokeOpacity={0.6}
        strokeWidth={0.75}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: contentDelay }}
      />

      {/* Product type label */}
      <motion.text
        x={ix + 8}
        y={iy + INNER_HEADER_H / 2 + 1}
        dominantBaseline="central"
        fill="hsl(var(--muted-foreground))"
        fillOpacity={isComposed ? 0.7 : 0.4}
        fontSize={9}
        fontWeight={600}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: contentDelay }}
      >
        Product
      </motion.text>

      {/* Inner header separator */}
      <motion.line
        x1={ix}
        y1={iy + INNER_HEADER_H}
        x2={ix + iw}
        y2={iy + INNER_HEADER_H}
        stroke="hsl(var(--border))"
        strokeOpacity={0.4}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: contentDelay }}
      />

      {/* Shimmer gradient for skeleton bars */}
      <defs>
        <linearGradient id="skeleton-shimmer" gradientUnits="userSpaceOnUse" y1="0" y2="0">
          <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.08} />
          <stop offset="35%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.08} />
          <stop offset="50%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.24} />
          <stop offset="65%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.08} />
          <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.08} />
          <animate attributeName="x1" values={`${ix - iw};${ix + iw}`} dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="x2" values={`${ix};${ix + iw * 2}`} dur="1.5s" repeatCount="indefinite" />
        </linearGradient>
      </defs>

      {/* Skeleton bars — show first, then crossfade to text when composed */}
      {COMPOSED_PRODUCT_FIELDS.map((_, i) => {
        const skeletonWidths = [40, 55, 70, 45, 80, 65];
        const fieldY = iy + INNER_HEADER_H + 4 + i * FIELD_LINE_H + FIELD_SIZE / 2;
        return (
          <motion.rect
            key={`skeleton-${i}`}
            x={ix + 8}
            y={fieldY - 3}
            width={skeletonWidths[i % skeletonWidths.length]}
            height={6}
            rx={3}
            fill="url(#skeleton-shimmer)"
            initial={{ opacity: 0 }}
            animate={{
              opacity: isComposed ? [0, 1, 1, 0] : 1,
            }}
            transition={{
              duration: isComposed ? 1.0 : 0.2,
              delay: contentDelay + 0.05,
              times: isComposed ? [0, 0.15, 0.55, 1] : undefined,
            }}
          />
        );
      })}

      {/* Fields — appear after skeletons fade, reviews field highlighted */}
      {COMPOSED_PRODUCT_FIELDS.map((field, i) => {
        const isReviewsField = field.startsWith('reviews');
        return (
          <motion.text
            key={field}
            x={ix + 8}
            y={iy + INNER_HEADER_H + 4 + i * FIELD_LINE_H + FIELD_SIZE}
            fill={isReviewsField ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
            fontWeight={isReviewsField ? 600 : 400}
            fontSize={FIELD_SIZE}
            fontFamily={MONO_FONT}
            initial={{ opacity: 0 }}
            animate={{ opacity: isComposed ? 1 : 0 }}
            transition={{ duration: 0.3, delay: isComposed ? contentDelay + 0.85 : 0 }}
          >
            {field}
          </motion.text>
        );
      })}

      {/* ── Review type box (appears after subgraph boxes disappear) ── */}

      <defs>
        <TypeBoxClipDefs
          prefix="super-review"
          fields={REVIEW_FIELDS}
          ix={ix}
          iy={reviewIy}
          iw={iw}
          visible={isFinished}
          duration={0.4}
          baseDelay={reviewContentDelay}
          stagger={0.08}
        />
      </defs>

      {/* Review inner box — zooms in from center */}
      <motion.rect
        initial={{ x: reviewCx, y: reviewCy, width: 0, height: 0, rx: INNER_R }}
        animate={
          isFinished
            ? { x: ix, y: reviewIy, width: iw, height: reviewIh, rx: INNER_R }
            : { x: reviewCx, y: reviewCy, width: 0, height: 0, rx: INNER_R }
        }
        transition={ease(0.4, isFinished ? reviewContentDelay : 0)}
        fill="hsl(var(--muted))"
        fillOpacity={0.3}
        stroke="hsl(var(--border))"
        strokeOpacity={0.6}
        strokeWidth={0.75}
      />

      {/* Review type label — clipped for wipe */}
      <g clipPath="url(#super-review-type)">
        <motion.text
          x={ix + 8}
          y={reviewIy + INNER_HEADER_H / 2 + 1}
          dominantBaseline="central"
          fill="hsl(var(--muted-foreground))"
          fillOpacity={0.7}
          fontSize={9}
          fontWeight={600}
          initial={{ opacity: 0 }}
          animate={{ opacity: isFinished ? 1 : 0 }}
          transition={{ duration: 0.2, delay: isFinished ? reviewContentDelay + 0.2 : 0 }}
        >
          Review
        </motion.text>
      </g>

      {/* Review inner header separator — expands from center */}
      <motion.line
        y1={reviewIy + INNER_HEADER_H}
        y2={reviewIy + INNER_HEADER_H}
        stroke="hsl(var(--border))"
        strokeOpacity={0.4}
        initial={{ x1: ix + iw / 2, x2: ix + iw / 2 }}
        animate={isFinished ? { x1: ix, x2: ix + iw } : { x1: ix + iw / 2, x2: ix + iw / 2 }}
        transition={ease(0.3, isFinished ? reviewContentDelay + 0.3 : 0)}
      />

      <ClippedFields
        clipPrefix="super-review"
        fields={REVIEW_FIELDS}
        ix={ix}
        iy={reviewIy}
        textOpacity={isFinished ? 1 : 0}
        duration={0.2}
        delay={isFinished ? reviewContentDelay + 0.2 : 0}
      />
    </motion.g>
  );
};

const AnimatedCurve = ({
  d,
  delay,
  isComposed,
  isFinished,
  reverse,
  clipId,
}: {
  d: string;
  delay: number;
  isComposed: boolean;
  isFinished: boolean;
  reverse?: boolean;
  clipId: string;
}) => (
  <g clipPath={`url(#${clipId})`}>
    <motion.path
      key={isComposed ? 'composed' : 'pending'}
      d={d}
      fill="none"
      stroke={isFinished ? 'hsl(var(--border))' : isComposed ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
      strokeOpacity={isFinished ? 0.3 : isComposed ? 0.8 : 0.35}
      strokeWidth={isComposed && !isFinished ? 2 : 1.5}
      strokeDasharray="8 6"
      strokeLinecap="round"
      initial={{ opacity: isComposed ? 1 : 0 }}
      animate={{
        opacity: 1,
        strokeDashoffset: [0, reverse ? 28 : -28],
      }}
      transition={{
        opacity: { duration: 0.4, delay: isComposed ? 0 : delay },
        strokeDashoffset: {
          duration: isFinished ? 0 : isComposed ? 0.7 : 3,
          repeat: isFinished ? 0 : Infinity,
          ease: 'linear',
          delay: isComposed ? 0 : delay,
        },
      }}
    />
  </g>
);

export const FederationAnimation = ({ status }: { status: 'pending' | 'ok' | 'fail' | 'error' }) => {
  const isComposed = status === 'ok';
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    if (!isComposed) {
      setIsFinished(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsFinished(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, [isComposed]);

  // Line clip regions — shrink from supergraph toward subgraph
  const leftLineX1 = PRODUCTS_X + SIDE_W;
  const leftLineX2 = SUPER_X;
  const leftLineW = leftLineX2 - leftLineX1;

  const rightLineX1 = SUPER_X + CENTER_W;
  const rightLineX2 = REVIEWS_X;
  const rightLineW = rightLineX2 - rightLineX1;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-muted/30">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full">
        {/* Clip definitions for dashed line shrink */}
        <defs>
          {/* Left line clip: grows from products toward supergraph, shrinks back on finish */}
          <clipPath id="left-line-clip">
            <motion.rect
              y={CENTER_Y - 10}
              height={20}
              initial={{ x: leftLineX1, width: 0 }}
              animate={{
                x: leftLineX1,
                width: isFinished ? 0 : leftLineW,
              }}
              transition={isFinished ? ease(FINISH_DASH_DURATION, FINISH_DASH_DELAY) : ease(0.6, 1.5)}
            />
          </clipPath>
          {/* Right line clip: grows from reviews toward supergraph, shrinks back on finish */}
          <clipPath id="right-line-clip">
            <motion.rect
              y={CENTER_Y - 10}
              height={20}
              initial={{ x: rightLineX2, width: 0 }}
              animate={{
                x: isFinished ? rightLineX2 : rightLineX1,
                width: isFinished ? 0 : rightLineW,
              }}
              transition={isFinished ? ease(FINISH_DASH_DURATION, FINISH_DASH_DELAY) : ease(0.6, 1.5)}
            />
          </clipPath>
        </defs>

        <AnimatedCurve
          d={LEFT_LINE}
          delay={1.5}
          isComposed={isComposed}
          isFinished={isFinished}
          clipId="left-line-clip"
        />
        <AnimatedCurve
          d={RIGHT_LINE}
          delay={1.5}
          isComposed={isComposed}
          isFinished={isFinished}
          reverse
          clipId="right-line-clip"
        />

        <SubgraphNode
          x={PRODUCTS_X}
          y={PRODUCTS_Y}
          w={SIDE_W}
          h={PRODUCTS_H}
          name="products"
          typeName="Product"
          fields={PRODUCT_FIELDS}
          delay={0.5}
          isComposed={isComposed}
          isFinished={isFinished}
        />
        <SubgraphNode
          x={REVIEWS_X}
          y={REVIEWS_Y}
          w={SIDE_W}
          h={REVIEWS_H}
          name="reviews"
          typeName="Review"
          fields={REVIEW_FIELDS}
          delay={0}
          isComposed={isComposed}
          isFinished={isFinished}
        />
        <SupergraphNode
          x={SUPER_X}
          y={SUPER_Y}
          w={CENTER_W}
          h={SUPER_H}
          delay={1}
          isComposed={isComposed}
          isFinished={isFinished}
        />
      </svg>
    </div>
  );
};
