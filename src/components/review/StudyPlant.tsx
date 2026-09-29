import type { PlantReadinessStage } from "@/lib/review/stats";
import styles from "./StudyPlant.module.css";

export function StudyPlant({
  stage,
  dueCount,
}: {
  stage: PlantReadinessStage;
  dueCount: number;
}) {
  const label =
    dueCount === 0
      ? "No words ready; a resting seed"
      : `${dueCount} ${dueCount === 1 ? "word" : "words"} ready; ${stage} plant`;

  return (
    <svg
      className={`${styles.plant} ${styles[stage]}`}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
    >
      <path className={styles.ground} d="M10 54 H54" />

      {stage === "seed" && (
        <g>
          <ellipse className={styles.seedBody} cx="32" cy="50" rx="7" ry="4" />
          <path className={styles.seedShoot} d="M32 48 C31 43 35 41 34 36" />
        </g>
      )}

      {stage === "sprout" && (
        <g className={styles.sproutPlant}>
          <path
            className={styles.plantStems}
            d="M32 54 C31 47 32 39 31 33 M31.5 44 L27 40 M31.5 39 L36 35"
          />
          <path
            className={styles.leaf}
            d="M28 41 C21 43 17 39 17 35 C23 34 28 36 28 41Z"
          />
          <path
            className={styles.leaf}
            d="M35 36 C35 30 40 28 45 29 C44 34 41 38 35 36Z"
          />
          <path
            className={styles.leaf}
            d="M31 34 C27 31 27 26 30 23 C34 26 35 30 31 34Z"
          />
          <path
            className={styles.leafVeins}
            d="M28 41 L21 37 M35 36 L41 31 M31 34 L30 27"
          />
        </g>
      )}

      {stage === "growing" && (
        <g className={styles.growingPlant}>
          <g className={styles.plantStems}>
            <path d="M31 54 C31 42 28 32 29 25 C30 13 40 11 40 19" />
            <path d="M31 53 C26 44 25 36 24 31 C23 21 16 20 16 25" />
            <path d="M32 54 C35 45 37 39 39 33 C42 26 48 28 47 35" />
            <path d="M29 33 L25 28 M29 28 L29 23 M28 43 L22 40 M35 45 L41 43" />
          </g>
          <path
            className={styles.leaf}
            d="M25 28 C18 29 14 25 14 20 C20 19 25 22 25 28Z"
          />
          <path
            className={styles.leaf}
            d="M29 24 C24 20 24 15 28 12 C32 15 33 20 29 24Z"
          />
          <path
            className={styles.leaf}
            d="M28 43 C20 45 15 41 14 36 C21 34 27 37 28 43Z"
          />
          <path
            className={styles.leaf}
            d="M38 38 C37 31 42 27 49 28 C49 34 44 39 38 38Z"
          />
          <path
            className={styles.leaf}
            d="M39 44 C40 39 45 38 49 41 C46 46 42 47 39 44Z"
          />
          <path
            className={styles.leafVeins}
            d="M25 28 L18 23 M29 24 L28 16 M28 43 L19 38 M38 38 L45 31 M39 44 L45 42"
          />
          {[
            { x: 16, y: 27 },
            { x: 40, y: 19 },
            { x: 47, y: 37 },
          ].map(({ x, y }) => (
            <g key={x} transform={`translate(${x} ${y})`} aria-hidden="true">
              <g className={styles.flower}>
                <circle
                  className={styles.flowerPetal}
                  cx="0"
                  cy="-3.5"
                  r="2.5"
                />
                <circle
                  className={styles.flowerPetal}
                  cx="3.5"
                  cy="-1"
                  r="2.5"
                />
                <circle className={styles.flowerPetal} cx="2" cy="3" r="2.5" />
                <circle className={styles.flowerPetal} cx="-2" cy="3" r="2.5" />
                <circle
                  className={styles.flowerPetal}
                  cx="-3.5"
                  cy="-1"
                  r="2.5"
                />
                <circle className={styles.flowerCenter} cx="0" cy="0" r="2" />
              </g>
            </g>
          ))}
        </g>
      )}

      {stage === "ripe" && (
        <g className={styles.ripePlant}>
          <g className={styles.plantStems}>
            <path d="M31 54 C31 42 28 32 29 22 C30 9 40 9 40 17" />
            <path d="M31 53 C25 43 24 34 23 27 C22 19 16 19 16 25" />
            <path d="M29 30 L24 21 M30 39 L21 35 M34 46 L41 42 M36 41 L42 37 M29 25 L29 17" />
          </g>
          <g>
            <path
              className={styles.leaf}
              d="M24 21 C16 22 12 17 12 12 C19 11 25 14 24 21Z"
            />
            <path
              className={styles.leaf}
              d="M29 19 C23 14 24 8 28 5 C33 9 34 15 29 19Z"
            />
            <path
              className={styles.leaf}
              d="M30 29 C30 21 34 19 39 20 C39 26 36 30 30 29Z"
            />
            <path
              className={styles.leaf}
              d="M23 36 C14 39 9 35 8 30 C15 27 22 29 23 36Z"
            />
            <path
              className={styles.leaf}
              d="M41 38 C40 30 46 25 54 26 C54 33 49 39 41 38Z"
            />
            <path
              className={styles.leaf}
              d="M30 46 C21 48 16 44 15 39 C23 37 29 40 30 46Z"
            />
            <path
              className={styles.leaf}
              d="M38 44 C40 37 46 38 51 41 C47 47 42 48 38 44Z"
            />
            <path
              className={styles.leafVeins}
              d="M24 21 L16 15 M29 19 L28 10 M30 29 L36 23 M23 36 L13 32 M41 38 L50 29 M30 46 L20 41 M38 44 L46 42"
            />
          </g>
          <path
            className={styles.plantStems}
            d="M32 54 C35 45 37 39 39 33 C42 26 48 28 47 35"
          />
          {[
            { x: 16, y: 25, scale: 0.85 },
            { x: 40, y: 17, scale: 1 },
            { x: 47, y: 35, scale: 0.85 },
          ].map(({ x, y, scale }) => (
            <g key={x} transform={`translate(${x} ${y}) scale(${scale})`}>
              <path
                className={styles.berry}
                d="M0 0 C-4 -2 -7 1 -6 5 C-5 9 -2 12 0 12 C2 12 5 9 6 5 C7 1 4 -2 0 0Z"
              />
              <path
                className={styles.berryCap}
                d="M0 1 C-3 2 -4 1 -5 0 C-3 -1 -1 -1 0 0 C1 -1 3 -1 5 0 C4 1 3 2 0 1Z"
              />
              <path className={styles.berryShine} d="M-3 3 L-3.5 4.5" />
              <path
                className={styles.berrySeeds}
                d="M1 3 V3.5 M3 5.5 V6 M-1 6 V6.5 M0.5 9 V9.5 M-3 8 V8.5"
              />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
