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
          <path className={styles.stem} d="M32 53 C31 43 33 34 32 25" />
          <path
            className={styles.leaf}
            d="M31 38 C21 36 20 30 20 28 C27 28 31 31 31 38Z"
          />
          <path
            className={styles.leaf}
            d="M33 32 C42 30 45 25 44 22 C37 22 33 26 33 32Z"
          />
        </g>
      )}

      {stage === "growing" && (
        <g className={styles.growingPlant}>
          <path className={styles.stem} d="M32 54 C29 43 35 29 32 13" />
          <path className={styles.branch} d="M33 32 C38 28 42 25 48 24" />
          <path className={styles.branch} d="M31 39 C30 39 29 39 28 39" />
          <path
            className={styles.leaf}
            d="M28 39 C18 41 14 36 13 32 C20 30 26 33 28 39Z"
          />
          <path
            className={styles.leaf}
            d="M35 31 C45 33 50 28 51 23 C43 21 37 25 35 31Z"
          />
          <path
            className={styles.leaf}
            d="M31 28 C23 25 22 20 23 17 C29 18 33 22 31 28Z"
          />
          <g className={styles.flower} aria-hidden="true">
            <circle className={styles.flowerPetal} cx="32" cy="7" r="2.5" />
            <circle className={styles.flowerPetal} cx="36" cy="10" r="2.5" />
            <circle className={styles.flowerPetal} cx="34" cy="15" r="2.5" />
            <circle className={styles.flowerPetal} cx="29" cy="14" r="2.5" />
            <circle className={styles.flowerPetal} cx="28" cy="9" r="2.5" />
            <circle className={styles.flowerCenter} cx="32" cy="11" r="2.25" />
          </g>
        </g>
      )}

      {stage === "ripe" && (
        <g className={styles.ripePlant}>
          <path className={styles.stem} d="M32 54 C29 43 35 29 32 13" />
          <path className={styles.branch} d="M33 32 C36 30 39 27 41 25" />
          <path className={styles.branch} d="M31 39 C29 37 26 34 24 32" />
          <path
            className={styles.leaf}
            d="M28 39 C18 41 14 36 13 32 C20 30 26 33 28 39Z"
          />
          <path
            className={styles.leaf}
            d="M35 31 C45 33 50 28 51 23 C43 21 37 25 35 31Z"
          />
          <path
            className={styles.leaf}
            d="M31 28 C23 25 22 20 23 17 C29 18 33 22 31 28Z"
          />
          <g aria-hidden="true">
            <path className={styles.redThorn} d="M31 47 L26 44 L31 43Z" />
            <path className={styles.goldThorn} d="M33 27 L37 23 L34 29Z" />
            <path className={styles.redThorn} d="M28 36 L25 31 L30 34Z" />
            <path className={styles.goldThorn} d="M36 30 L39 25 L39 29Z" />
          </g>
          <g className={styles.berries}>
            <circle className={styles.berry} cx="24" cy="36" r="4.5" />
            <circle className={styles.berry} cx="41" cy="29" r="4" />
            <circle className={styles.happyBerry} cx="32" cy="11" r="7" />
            <circle
              className={styles.berryHighlight}
              cx="29.5"
              cy="8"
              r="1.5"
            />
            <circle className={styles.face} cx="29.5" cy="11" r="0.8" />
            <circle className={styles.face} cx="34.5" cy="11" r="0.8" />
            <path className={styles.smile} d="M29.5 14 C31 16 33.5 16 35 14" />
          </g>
        </g>
      )}
    </svg>
  );
}
