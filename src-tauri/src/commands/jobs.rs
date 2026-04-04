use reqwest::Client;
use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::time::Duration;

const JOB_SERVER_BASE_URL: &str = "http://127.0.0.1:3847";

async fn is_job_server_alive() -> bool {
    let client = match Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client
        .get(format!("{}/health", JOB_SERVER_BASE_URL))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn start_job_server() -> Result<(), String> {
    if is_job_server_alive().await {
        return Ok(());
    }

    Command::new("node")
        .arg("src/services/jobs/server.js")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start job server: {}", error))?;

    Ok(())
}

#[tauri::command]
pub async fn submit_job(
    job_type: String,
    input_data: Value,
    depends_on: Option<Vec<String>>,
    priority: Option<i32>,
) -> Result<String, String> {
    let client = Client::new();
    let response = client
        .post(format!("{}/api/jobs", JOB_SERVER_BASE_URL))
        .json(&json!({
            "type": job_type,
            "inputData": input_data,
            "dependsOn": depends_on.unwrap_or_default(),
            "priority": priority,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to submit job: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("No error body"));
        return Err(format!("Submit job failed ({}): {}", status, body));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid submit response: {}", error))?;

    payload
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| String::from("Submit response missing job id"))
}

#[tauri::command]
pub async fn get_status(job_id: String) -> Result<Value, String> {
    let client = Client::new();
    let response = client
        .get(format!("{}/api/jobs/{}", JOB_SERVER_BASE_URL, job_id))
        .send()
        .await
        .map_err(|error| format!("Failed to fetch job status: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("No error body"));
        return Err(format!("Get status failed ({}): {}", status, body));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Invalid status response: {}", error))
}

#[tauri::command]
pub async fn cancel_job(job_id: String) -> Result<(), String> {
    let client = Client::new();
    let response = client
        .delete(format!("{}/api/jobs/{}", JOB_SERVER_BASE_URL, job_id))
        .send()
        .await
        .map_err(|error| format!("Failed to cancel job: {}", error))?;

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| String::from("No error body"));
    Err(format!("Cancel job failed ({}): {}", status, body))
}

