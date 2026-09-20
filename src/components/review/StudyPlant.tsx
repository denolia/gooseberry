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
              d="M32 21 C30 17 26 16 25 12 C28 12 29 10 28 7 C31 8 33 10 34 13 C36 10 39 10 41 12 C40 16 37 19 32 21Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M25 28 C20 26 15 25 11 21 C14 20 15 18 14 15 C18 16 21 18 23 20 C23 17 25 16 27 17 C28 21 27 25 25 28Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M39 28 C44 26 49 25 53 21 C50 20 49 18 50 15 C46 16 43 18 41 20 C41 17 39 16 37 17 C36 21 37 25 39 28Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M29 46 C24 44 18 43 15 39 C18 38 19 36 18 33 C22 34 25 36 27 38 C27 35 29 34 31 35 C32 39 31 43 29 46Z"
            />
            <path
              className={styles.ripeLeaf}
              d="M35 46 C40 44 46 43 49 39 C46 38 45 36 46 33 C42 34 39 36 37 38 C37 35 35 34 33 35 C32 39 33 43 35 46Z"
            />
            <path
              className={styles.leafVein}
              d="M32 20 L32 10 M32 15 L28 12 M32 16 L37 12"
            />
            <path
              className={styles.leafVein}
              d="M24 26 L15 19 M20 23 L15 23 M20 23 L20 18"
            />
            <path
              className={styles.leafVein}
              d="M40 26 L49 19 M44 23 L49 23 M44 23 L44 18"
            />
            <path className={styles.leafVein} d="M28 44 L19 37 M24 41 L19 41" />
            <path className={styles.leafVein} d="M36 44 L45 37 M40 41 L45 41" />
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
            <path d="M16 23 C18 22 18 20 17 19" />
            <path d="M48 23 C46 22 46 20 47 19" />
            <path d="M24 38 C25 37 26 35 26 34" />
            <path d="M40 38 C39 37 38 35 38 34" />
          </g>
          <g aria-hidden="true">
            <path className={styles.redThorn} d="M32 49 L28 46 L32 45Z" />
            <path className={styles.goldThorn} d="M36 38 L40 34 L38 40Z" />
          </g>
          <g className={styles.berryCluster}>
            <g>
              <ellipse
                className={styles.gooseberry}
                cx="16"
                cy="31"
                rx="5.5"
                ry="7.5"
              />
              <path
                className={styles.berryStripe}
                d="M14 25 C13 29 13 34 15 37"
              />
              <path
                className={styles.berryStripe}
                d="M18 24.5 C20 29 20 34 18 37.5"
              />
              <ellipse
                className={styles.berryGloss}
                cx="14"
                cy="27.5"
                rx="1.1"
                ry="1.8"
              />
              <path
                className={styles.berryCalyx}
                d="M13.5 38 L14.5 42 L16 39.5 L18 42 L18.5 38Z"
              />
            </g>
            <g>
              <ellipse
                className={styles.gooseberry}
                cx="48"
                cy="31"
                rx="5.5"
                ry="7.5"
              />
              <path
                className={styles.berryStripe}
                d="M46 24.5 C44 29 44 34 46 37.5"
              />
              <path
                className={styles.berryStripe}
                d="M50 25 C51 29 51 34 49 37"
              />
              <ellipse
                className={styles.berryGloss}
                cx="46"
                cy="27.5"
                rx="1.1"
                ry="1.8"
              />
              <path
                className={styles.berryCalyx}
                d="M45.5 38 L46.5 42 L48 39.5 L50 42 L50.5 38Z"
              />
            </g>
            <g>
              <ellipse
                className={styles.gooseberry}
                cx="23.5"
                cy="44"
                rx="5"
                ry="6.5"
              />
              <path
                className={styles.berryStripe}
                d="M22 38.5 C21 42 21 46 22.5 49.5"
              />
              <path
                className={styles.berryStripe}
                d="M25 38.5 C27 42 27 46 25 50"
              />
              <ellipse
                className={styles.berryGloss}
                cx="22"
                cy="40.5"
                rx="0.9"
                ry="1.4"
              />
              <path
                className={styles.berryCalyx}
                d="M21.5 50 L22.5 53.5 L24 51 L25.5 53.5 L26 50Z"
              />
            </g>
            <g>
              <ellipse
                className={styles.gooseberry}
                cx="40.5"
                cy="44"
                rx="5"
                ry="6.5"
              />
              <path
                className={styles.berryStripe}
                d="M39 38.5 C37 42 37 46 39 50"
              />
              <path
                className={styles.berryStripe}
                d="M42 38.5 C43 42 43 46 41.5 49.5"
              />
              <ellipse
                className={styles.berryGloss}
                cx="39"
                cy="40.5"
                rx="0.9"
                ry="1.4"
              />
              <path
                className={styles.berryCalyx}
                d="M38.5 50 L39.5 53.5 L41 51 L42.5 53.5 L43 50Z"
              />
            </g>
            <g>
              <ellipse
                className={styles.happyGooseberry}
                cx="32"
                cy="30"
                rx="8.5"
                ry="10"
              />
              <path
                className={styles.berryStripe}
                d="M28 21.5 C25.5 27 25.5 34 28.5 38.5"
              />
              <path
                className={styles.berryStripe}
                d="M32 20 C31 26 31 34 32 40"
              />
              <path
                className={styles.berryStripe}
                d="M36 21.5 C38.5 27 38.5 34 35.5 38.5"
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
              <path
                className={styles.berryCalyx}
                d="M28.5 39 L30 44 L32 41 L34 44 L35.5 39Z"
              />
            </g>
          </g>
        </g>
      )}
    </svg>
  );
}
