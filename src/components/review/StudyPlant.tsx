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
          <g className={styles.ripeLeaves}>
            <path
              className={styles.ripeLeaf}
              d="M32 21 C24 18 23 12 25 8 C31 10 34 15 32 21Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M27 29 C17 30 13 24 13 20 C21 19 26 23 27 29Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M37 29 C47 30 51 24 51 20 C43 19 38 23 37 29Z"
            />
            <path className={styles.leafVein} d="M32 20 L26 10" />
            <path className={styles.leafVein} d="M25 27 L16 22" />
            <path className={styles.leafVein} d="M39 27 L48 22" />
          </g>
          <g className={styles.woodyBranches}>
            <path d="M32 54 C34 45 31 33 32 19" />
            <path d="M32 29 C25 26 21 22 16 20" />
            <path d="M32 29 C39 26 43 22 48 20" />
            <path d="M32 38 C28 38 25 39 23 41" />
            <path d="M32 38 C36 38 39 39 41 41" />
          </g>
          <g className={styles.fruitStems}>
            <path d="M32 20 C34 18 34 16 33 14" />
            <path d="M16 26 C18 23 18 21 17 19" />
            <path d="M48 26 C46 23 46 21 47 19" />
            <path d="M24 38 C25 37 26 35 26 34" />
            <path d="M40 38 C39 37 38 35 38 34" />
          </g>
          <g className={styles.berryCluster}>
            <g>
              <circle className={styles.gooseberry} cx="16" cy="31" r="5.5" />
              <path
                className={styles.berryStripe}
                d="M14 26 C13 29 13.5 33 15 36"
              />
              <path
                className={styles.berryStripe}
                d="M18 26 C19.5 29 19 33 17.5 36"
              />
              <ellipse
                className={styles.berryGloss}
                cx="14"
                cy="28"
                rx="1"
                ry="1.5"
              />
              <path className={styles.berryThorn} d="M15 36 L16 39.5 L17 36Z" />
            </g>
            <g>
              <circle className={styles.gooseberry} cx="48" cy="31" r="5.5" />
              <path
                className={styles.berryStripe}
                d="M46 26 C44.5 29 45 33 46.5 36"
              />
              <path
                className={styles.berryStripe}
                d="M50 26 C51 29 50.5 33 49 36"
              />
              <ellipse
                className={styles.berryGloss}
                cx="46"
                cy="28"
                rx="1"
                ry="1.5"
              />
              <path className={styles.berryThorn} d="M47 36 L48 39.5 L49 36Z" />
            </g>
            <g>
              <circle className={styles.gooseberry} cx="23.5" cy="44" r="5" />
              <path
                className={styles.berryStripe}
                d="M22 39.5 C21 42 21.5 46 22.5 48"
              />
              <path
                className={styles.berryStripe}
                d="M25 39.5 C26 42 26 46 25 48"
              />
              <ellipse
                className={styles.berryGloss}
                cx="22"
                cy="40.5"
                rx="0.9"
                ry="1.4"
              />
              <path
                className={styles.berryThorn}
                d="M22.5 48.5 L23.5 52 L24.5 48.5Z"
              />
            </g>
            <g>
              <circle className={styles.gooseberry} cx="40.5" cy="44" r="5" />
              <path
                className={styles.berryStripe}
                d="M39 39.5 C38 42 38 46 39 48"
              />
              <path
                className={styles.berryStripe}
                d="M42 39.5 C43 42 42.5 46 41.5 48"
              />
              <ellipse
                className={styles.berryGloss}
                cx="39"
                cy="40.5"
                rx="0.9"
                ry="1.4"
              />
              <path
                className={styles.berryThorn}
                d="M39.5 48.5 L40.5 52 L41.5 48.5Z"
              />
            </g>
            <g>
              <circle
                className={styles.happyGooseberry}
                cx="32"
                cy="30"
                r="8.5"
              />
              <path
                className={styles.berryStripe}
                d="M28 23 C26 27 26 33 28.5 37"
              />
              <path
                className={styles.berryStripe}
                d="M32 21.5 C31 27 31 33 32 38.5"
              />
              <path
                className={styles.berryStripe}
                d="M36 23 C38 27 38 33 35.5 37"
              />
              <g className={styles.berrySparkles}>
                <ellipse
                  className={styles.berryGloss}
                  cx="28.5"
                  cy="24.5"
                  rx="1.4"
                  ry="2.1"
                />
                <circle
                  className={styles.berryGloss}
                  cx="27.5"
                  cy="28.5"
                  r="0.7"
                />
              </g>
              <circle
                className={styles.berryBlush}
                cx="27.5"
                cy="33.5"
                r="1.3"
              />
              <circle
                className={styles.berryBlush}
                cx="36.5"
                cy="33.5"
                r="1.3"
              />
              <circle className={styles.face} cx="29" cy="29.5" r="1.15" />
              <circle className={styles.face} cx="35" cy="29.5" r="1.15" />
              <circle
                className={styles.eyeGlint}
                cx="28.7"
                cy="29.1"
                r="0.35"
              />
              <circle
                className={styles.eyeGlint}
                cx="34.7"
                cy="29.1"
                r="0.35"
              />
              <path
                className={styles.smile}
                d="M29.5 32 C30.5 35 33.5 35 34.5 32"
              />
              <path className={styles.berryThorn} d="M31 38 L32 42 L33 38Z" />
            </g>
          </g>
        </g>
      )}
    </svg>
  );
}
