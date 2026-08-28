# Week 14 — Machine learning architecture

## Key concepts (my study notes)
- **Three learning types:** **supervised** (inputs with labelled desired outputs; classification and
  regression) · **unsupervised** (no labels — finds trends and commonalities; customer segmentation)
  · **reinforcement** (learns by trial and error toward a goal).
- **The ML pipeline:** **data acquisition** (collect, prepare, segregate; continuous data through
  stream processing, discrete data into a warehouse) → **data processing** (cleaning, normalisation,
  transformation, encoding) → **data modelling** (algorithm selection) → **execution / training**
  (train → validate → test) → **deployment**.
- **Training vocabulary:** **hyperparameters** are set *before* training and govern how the
  algorithm runs, unlike parameters learned during it; **hyperparameter tuning** produces many
  candidate models; **model selection** picks one against accuracy, data-preparation effort and
  processing cost; **scoring** (prediction) applies the trained model to new input and can output a
  ranked list, a numeric value, or a probability of belonging to a category.
- **Deployment:** an ML model is **an artifact like any other build output** and should be promoted
  to production the same way.
- **The seven patterns of AI:** hyper-personalisation · recognition · conversation and human
  interaction · predictive analytics and decisions · goal-driven systems · autonomous systems ·
  **patterns and anomalies** — the last of which is explicitly *fraud and risk detection*.

## What clicked
Both AI components in this design land on the map, and they land in different places. The fraud
engine is the **patterns and anomalies** pattern — the summary names fraud detection as its
canonical use. The financial advisor is **conversational** on the surface, but what makes it useful
is **hyper-personalisation** and **predictive analytics**: a profile that adapts, and advice that
helps a human decide. Recognising those as different patterns explains why they get different
architectures rather than one shared "AI service".

"A model is an artifact" ties directly back to week 10. It means model versions are promoted through
the same pipeline, the model version travels on the fraud verdict, and a bad model can be rolled
back like any other release. That is what makes running a new model in **shadow** against live
traffic — before it gates a single transfer — a normal deployment practice rather than a special
case.

The **scoring output types** also clarified the fraud contract: what the real-time scorer returns
is a probability, and the *policy* — not the model — turns that probability into allow, block, or a
timeout classification. Keeping those two things separate is what lets the threshold move without
retraining.

## Questions this raises for my NeoBank design
- Feature store: shared between the real-time and offline fraud models, or separate? → [D7](../solution/decisions.md)
- Model drift and retraining cadence — who owns it once the programme ends? → [§3.7](../solution/hld.md)
- Advisor model tier against cost: the largest Year-3 cloud line, and quality is the trade → [OI-06](../solution/hld.md)
- Training on tokenised data only, so no model ever memorises personal data → [P5](../solution/hld.md), [§3.5.7](../solution/hld.md)
- Explainability: a blocked transfer needs a reason the customer and the regulator can both accept → [FR-130](../solution/hld.md)
