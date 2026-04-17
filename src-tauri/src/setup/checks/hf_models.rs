//! Check 6 — pyannote model licences accepted on HuggingFace
//! (spec §22.3 + Amendment 3).
//!
//! Per Amendment 3, "the user needs to accept a licence" and "the user needs
//! better connectivity" are distinct UX states and must not collapse to the
//! same remediation. Earlier versions of this check conflated failure modes
//! with `Status` (e.g. treating all 401s as `WrongVersion`), which forced
//! the wizard to re-derive intent by branching on `status`. That inversion
//! was the regression. This implementation emits an explicit `failure_type`
//! string on every non-Ok `HfModelsDetails`, and the wizard's action card
//! reads that discriminator directly.
//!
//! Per-model → overall mapping:
//!
//!   HTTP  | per-model outcome            | status contribution
//!   ------|------------------------------|----------------------
//!   200   | accepted                     | Ok
//!   401   | TokenInvalid                 | WrongVersion
//!   403   | LicenceNotAccepted           | Missing
//!   5xx,  | NetworkError                 | Unknown
//!   network, timeout, client-build
//!   other | UnexpectedResponse           | Unknown
//!
//! When the two models disagree, the overall `failure_type` is the more
//! severe of the two per the precedence:
//!   `TokenInvalid` > `NetworkError` > `UnexpectedResponse` > `LicenceNotAccepted`.
//!
//! The pure `combine_failure_types` function is the only piece that needs
//! unit testing; the HTTP probing is validated in integration tests and by
//! the `--check-setup` CLI.

use std::time::Duration;

use super::super::types::{Check, HfModelsDetails, HfModelsFailureType, Status};

/// The two models we diarize with. Both require per-user licence acceptance
/// on HuggingFace.
const MODELS: &[(&str, &str, &str)] = &[
    (
        "diarization",
        "pyannote/speaker-diarization-3.1",
        "https://huggingface.co/api/models/pyannote/speaker-diarization-3.1",
    ),
    (
        "segmentation",
        "pyannote/segmentation-3.0",
        "https://huggingface.co/api/models/pyannote/segmentation-3.0",
    ),
];

/// Per-model probe result — the `failure_type` is None on 200.
struct ModelProbe {
    /// None when the model returned 200; Some(_) otherwise.
    failure_type: Option<HfModelsFailureType>,
    /// Human-readable note attached to the failure, if any.
    detail: Option<String>,
}

pub async fn check(token: &str) -> Check<HfModelsDetails> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            // Client construction failure is a connectivity-class problem
            // from the user's perspective. Emit it as `NetworkError` so the
            // wizard's action card shows a retry affordance rather than a
            // licence-accept one.
            return Check {
                status: Status::Unknown,
                details: Some(HfModelsDetails {
                    diarization: false,
                    segmentation: false,
                    failure_type: Some(HfModelsFailureType::NetworkError),
                }),
                message: Some(format!(
                    "Could not build HTTP client to query HF models: {e}"
                )),
            };
        }
    };

    // Populate with definite outcomes for each model.
    let mut diarization = ModelProbe {
        failure_type: Some(HfModelsFailureType::UnexpectedResponse),
        detail: None,
    };
    let mut segmentation = ModelProbe {
        failure_type: Some(HfModelsFailureType::UnexpectedResponse),
        detail: None,
    };

    for (kind, _slug, url) in MODELS {
        let probe = probe_one(&client, token, url, kind).await;
        match *kind {
            "diarization" => diarization = probe,
            "segmentation" => segmentation = probe,
            _ => {}
        }
    }

    let diarization_ok = diarization.failure_type.is_none();
    let segmentation_ok = segmentation.failure_type.is_none();

    // All green — return Ok with failure_type absent.
    if diarization_ok && segmentation_ok {
        return Check::ok(HfModelsDetails {
            diarization: true,
            segmentation: true,
            failure_type: None,
        });
    }

    // At least one model failed; combine to an overall failure_type and
    // derive the wire `status` + human message.
    let overall = combine_failure_types(diarization.failure_type, segmentation.failure_type)
        .expect("at least one outcome is non-None per the guard above");

    let status = status_for_failure(overall);
    let message = compose_message(
        overall,
        diarization_ok,
        segmentation_ok,
        &diarization.detail,
        &segmentation.detail,
    );

    Check {
        status,
        details: Some(HfModelsDetails {
            diarization: diarization_ok,
            segmentation: segmentation_ok,
            failure_type: Some(overall),
        }),
        message: Some(message),
    }
}

/// Issue one HEAD/GET and classify the response into an HfModelsFailureType
/// (or None on 200). Keeps the classification in one place so the tests
/// below — and future integration tests — don't have to re-implement the
/// status-code mapping.
async fn probe_one(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    kind: &str,
) -> ModelProbe {
    match client.get(url).bearer_auth(token).send().await {
        Ok(r) => match r.status().as_u16() {
            200 => ModelProbe {
                failure_type: None,
                detail: None,
            },
            401 => ModelProbe {
                failure_type: Some(HfModelsFailureType::TokenInvalid),
                detail: Some(format!(
                    "HuggingFace rejected the token on the {kind} model (401)."
                )),
            },
            403 => ModelProbe {
                failure_type: Some(HfModelsFailureType::LicenceNotAccepted),
                detail: Some(format!(
                    "The {kind} model requires licence acceptance (403)."
                )),
            },
            code @ 500..=599 => ModelProbe {
                failure_type: Some(HfModelsFailureType::NetworkError),
                detail: Some(format!(
                    "HuggingFace returned {code} for the {kind} model — retry later."
                )),
            },
            code => ModelProbe {
                failure_type: Some(HfModelsFailureType::UnexpectedResponse),
                detail: Some(format!(
                    "Unexpected status {code} checking {kind} — unable to verify licence."
                )),
            },
        },
        Err(e) => ModelProbe {
            failure_type: Some(HfModelsFailureType::NetworkError),
            detail: Some(format!(
                "Network error reaching huggingface.co while checking {kind}: {e}"
            )),
        },
    }
}

/// Pure precedence combinator. The UI contract is:
///   `TokenInvalid` > `NetworkError` > `UnexpectedResponse` > `LicenceNotAccepted`.
/// i.e. an authentication problem shadows a licence problem, because
/// telling someone to accept a licence when their token is invalid is a
/// failure of the instrument to reason about what it knows.
///
/// Returns `None` only when both inputs are `None` (i.e. both models 200).
pub(super) fn combine_failure_types(
    a: Option<HfModelsFailureType>,
    b: Option<HfModelsFailureType>,
) -> Option<HfModelsFailureType> {
    let severity = |f: HfModelsFailureType| -> u8 {
        match f {
            HfModelsFailureType::TokenInvalid => 4,
            HfModelsFailureType::NetworkError => 3,
            HfModelsFailureType::UnexpectedResponse => 2,
            HfModelsFailureType::LicenceNotAccepted => 1,
        }
    };
    match (a, b) {
        (None, None) => None,
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (Some(x), Some(y)) => Some(if severity(x) >= severity(y) { x } else { y }),
    }
}

fn status_for_failure(f: HfModelsFailureType) -> Status {
    match f {
        HfModelsFailureType::LicenceNotAccepted => Status::Missing,
        HfModelsFailureType::TokenInvalid => Status::WrongVersion,
        HfModelsFailureType::NetworkError => Status::Unknown,
        HfModelsFailureType::UnexpectedResponse => Status::Unknown,
    }
}

fn compose_message(
    overall: HfModelsFailureType,
    diarization_ok: bool,
    segmentation_ok: bool,
    diarization_detail: &Option<String>,
    segmentation_detail: &Option<String>,
) -> String {
    match overall {
        HfModelsFailureType::LicenceNotAccepted => {
            let mut slugs: Vec<&str> = Vec::new();
            if !diarization_ok {
                slugs.push("pyannote/speaker-diarization-3.1");
            }
            if !segmentation_ok {
                slugs.push("pyannote/segmentation-3.0");
            }
            format!(
                "Accept the licence on huggingface.co for: {}.",
                slugs.join(", ")
            )
        }
        HfModelsFailureType::TokenInvalid => {
            "HuggingFace rejected the token during model-licence check (401). \
             Re-validate the token in Settings."
                .to_string()
        }
        HfModelsFailureType::NetworkError => {
            // Prefer the more specific detail we captured from whichever model
            // tripped the network error first.
            diarization_detail
                .as_deref()
                .or(segmentation_detail.as_deref())
                .unwrap_or("Could not reach huggingface.co — retry later.")
                .to_string()
        }
        HfModelsFailureType::UnexpectedResponse => {
            diarization_detail
                .as_deref()
                .or(segmentation_detail.as_deref())
                .unwrap_or("Unable to verify licence status — retry later.")
                .to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combine_is_noop_when_both_accepted() {
        assert_eq!(combine_failure_types(None, None), None);
    }

    #[test]
    fn combine_passes_through_single_failure() {
        assert_eq!(
            combine_failure_types(Some(HfModelsFailureType::LicenceNotAccepted), None),
            Some(HfModelsFailureType::LicenceNotAccepted)
        );
        assert_eq!(
            combine_failure_types(None, Some(HfModelsFailureType::NetworkError)),
            Some(HfModelsFailureType::NetworkError)
        );
    }

    /// Amendment 3 precedence: 401 beats 403. An auth failure is a more
    /// severe signal than a licence-accept failure, because telling the
    /// user to accept a licence when their token is bad would waste their
    /// time and trust. This test pins the contract.
    #[test]
    fn token_invalid_outranks_licence_not_accepted() {
        assert_eq!(
            combine_failure_types(
                Some(HfModelsFailureType::TokenInvalid),
                Some(HfModelsFailureType::LicenceNotAccepted),
            ),
            Some(HfModelsFailureType::TokenInvalid),
        );
        // Order-independent.
        assert_eq!(
            combine_failure_types(
                Some(HfModelsFailureType::LicenceNotAccepted),
                Some(HfModelsFailureType::TokenInvalid),
            ),
            Some(HfModelsFailureType::TokenInvalid),
        );
    }

    #[test]
    fn network_error_outranks_licence_and_unexpected() {
        assert_eq!(
            combine_failure_types(
                Some(HfModelsFailureType::NetworkError),
                Some(HfModelsFailureType::LicenceNotAccepted),
            ),
            Some(HfModelsFailureType::NetworkError),
        );
        assert_eq!(
            combine_failure_types(
                Some(HfModelsFailureType::UnexpectedResponse),
                Some(HfModelsFailureType::NetworkError),
            ),
            Some(HfModelsFailureType::NetworkError),
        );
    }

    #[test]
    fn status_mapping_matches_spec() {
        assert_eq!(
            status_for_failure(HfModelsFailureType::LicenceNotAccepted),
            Status::Missing
        );
        assert_eq!(
            status_for_failure(HfModelsFailureType::TokenInvalid),
            Status::WrongVersion
        );
        assert_eq!(
            status_for_failure(HfModelsFailureType::NetworkError),
            Status::Unknown
        );
        assert_eq!(
            status_for_failure(HfModelsFailureType::UnexpectedResponse),
            Status::Unknown
        );
    }
}
