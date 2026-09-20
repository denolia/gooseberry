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
          <path className={styles.branch} d="M31 39 C26 35 22 32 17 30" />
          <path className={styles.branch} d="M33 32 C38 28 42 25 48 24" />
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
            d="M31 23 C23 20 22 15 23 12 C29 13 33 17 31 23Z"
          />
          <g className={styles.flower} aria-hidden="true">
            <circle className={styles.flowerPetal} cx="46" cy="21" r="2.5" />
            <circle className={styles.flowerPetal} cx="50" cy="24" r="2.5" />
            <circle className={styles.flowerPetal} cx="48" cy="29" r="2.5" />
            <circle className={styles.flowerPetal} cx="43" cy="28" r="2.5" />
            <circle className={styles.flowerPetal} cx="42" cy="23" r="2.5" />
            <circle className={styles.flowerCenter} cx="46" cy="25" r="2.25" />
          </g>
        </g>
      )}

      {stage === "ripe" && (
        <g className={styles.ripePlant}>
          <path className={styles.stem} d="M32 54 C29 43 35 29 32 12" />
          <path className={styles.branch} d="M31 38 C25 34 20 31 15 29" />
          <path className={styles.branch} d="M33 34 C39 30 44 27 50 27" />
          <path
            className={styles.leaf}
            d="M28 41 C17 43 12 38 12 33 C20 30 26 34 28 41Z"
          />
          <path
            className={styles.leaf}
            d="M36 32 C46 35 52 30 53 24 C44 22 38 26 36 32Z"
          />
          <path
            className={styles.leaf}
            d="M31 23 C22 20 21 14 23 10 C30 12 33 17 31 23Z"
          />
          <g className={styles.berries}>
            <circle className={styles.berry} cx="20" cy="34" r="5" />
            <circle className={styles.berry} cx="47" cy="33" r="4" />
            <circle className={styles.happyBerry} cx="36" cy="41" r="7" />
            <circle className={styles.berryHighlight} cx="34" cy="38" r="1.5" />
            <circle className={styles.face} cx="33.5" cy="41" r="0.8" />
            <circle className={styles.face} cx="38.5" cy="41" r="0.8" />
            <path className={styles.smile} d="M33.5 44 C35 46 37.5 46 39 44" />
          </g>
        </g>
      )}
    </svg>
  );
}
