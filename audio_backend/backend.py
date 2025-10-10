"""FastAPI backend for Azure OpenAI Realtime function calling demos.

This service exposes two responsibilities:
- issue short-lived ephemeral keys for WebRTC sessions with Azure OpenAI Realtime.
- execute function-calling callbacks (currently a horoscope generator) on behalf of the browser client.

The design keeps the function registry generic so new tools can be added in a single place
without touching the frontend. Each tool definition mirrors the OpenAI Realtime schema.
"""
from __future__ import annotations


import os
import json
import logging
import os
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
except ModuleNotFoundError as exc:  # pragma: no cover - module provided via dependencies
    raise RuntimeError(
        "azure-identity must be installed to run the backend service"
    ) from exc

from dotenv import load_dotenv
import inspect
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.json import JSON as RichJSON

load_dotenv()

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Realtime Function Calling Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo purposes only; tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _clean_env(name: str, default: str | None = None) -> str:
    raw = os.getenv(name, default)
    if raw is None:
        raise RuntimeError(f"Environment variable {name} must be set")
    return raw.strip().strip('"').strip("'")


REALTIME_SESSION_URL = _clean_env("AZURE_GPT_REALTIME_URL")
WEBRTC_URL = _clean_env("WEBRTC_URL")
DEFAULT_DEPLOYMENT = os.getenv("AZURE_GPT_REALTIME_DEPLOYMENT", "gpt-realtime")
DEFAULT_VOICE = os.getenv("AZURE_GPT_REALTIME_VOICE", "verse")
AZURE_API_KEY = os.getenv("AZURE_GPT_REALTIME_KEY")

FRONTEND_DIST_DIR = Path(__file__).resolve().parent / "frontend_dist"

print("REALTIME_SESSION_URL", REALTIME_SESSION_URL)
print("WEBRTC_URL", WEBRTC_URL)
print("DEFAULT_DEPLOYMENT", DEFAULT_DEPLOYMENT)
print("DEFAULT_VOICE", DEFAULT_VOICE)
print("AZURE_API_KEY", AZURE_API_KEY is not None)



credential = DefaultAzureCredential(exclude_interactive_browser_credential=False)
token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")


class SessionRequest(BaseModel):
    deployment: str | None = Field(default=None, description="Azure OpenAI deployment name")
    voice: str | None = Field(default=None, description="Voice to request in the session")


class SessionResponse(BaseModel):
    session_id: str = Field(..., description="Azure OpenAI WebRTC session id")
    ephemeral_key: str = Field(..., description="Ephemeral client secret for WebRTC auth")
    webrtc_url: str = Field(..., description="Regional WebRTC entry point")
    deployment: str = Field(..., description="Deployment used when requesting the session")
    voice: str = Field(..., description="Voice registered with the session")


class FunctionCallRequest(BaseModel):
    name: str = Field(..., description="Function/tool name requested by the model")
    call_id: str = Field(..., description="Unique call id supplied by Azure Realtime")
    arguments: Dict[str, Any] | str = Field(
        default_factory=dict,
        description="Arguments supplied by the model; may be JSON string or dict",
    )


class FunctionCallResponse(BaseModel):
    call_id: str
    output: Dict[str, Any]


ToolExecutor = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]] | Dict[str, Any]]


async def _get_auth_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if AZURE_API_KEY:
        headers["api-key"] = AZURE_API_KEY
        return headers

    # Prefer managed identity / Azure AD tokens when available
    token = await token_provider()
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _parse_arguments(arguments: Dict[str, Any] | str) -> Dict[str, Any]:
    if isinstance(arguments, dict):
        return arguments
    try:
        return json.loads(arguments)
    except json.JSONDecodeError as exc:  # pragma: no cover - invalid payloads are rare
        raise HTTPException(status_code=400, detail=f"Unable to parse arguments JSON: {exc}")


def _format_currency(amount: float) -> str:
    return f"${amount:.2f}"


def _format_currency_local(amount: float, currency_code: str = "AED") -> str:
    return f"{currency_code} {amount:,.2f}"


def _random_date_within(days: int, future: bool = True) -> str:
    delta = timedelta(days=random.randint(1, days))
    target = datetime.utcnow() + delta if future else datetime.utcnow() - delta
    return target.strftime("%Y-%m-%d")


def _random_time_slot() -> str:
    slots = ["8:00–10:00", "10:00–12:00", "12:00–14:00", "14:00–16:00", "16:00–18:00"]
    return random.choice(slots)


def _random_reference(prefix: str) -> str:
    return f"{prefix}-{random.randint(100000, 999999)}"


async def get_billing_info(arguments: Dict[str, Any]) -> Dict[str, Any]:
    billing_cycles = ["July 2025", "August 2025", "September 2025"]
    charges = [
        {"label": "Plan subscription", "amount": _format_currency(random.uniform(40, 65))},
        {"label": "International roaming", "amount": _format_currency(random.uniform(5, 25))},
        {"label": "Taxes & fees", "amount": _format_currency(random.uniform(6, 12))},
    ]
    status = random.choice(["Paid", "Pending", "Auto-pay scheduled"])
    return {
        "account_id": arguments.get("account_id"),
        "statement_period": random.choice(billing_cycles),
        "amount_due": _format_currency(random.uniform(45, 95)),
        "due_date": _random_date_within(12, future=True),
        "recent_charges": random.sample(charges, k=random.randint(1, len(charges))),
        "status": status,
    }


async def check_network_connectivity(arguments: Dict[str, Any]) -> Dict[str, Any]:
    status = random.choice(["Operational", "Degraded", "Investigating"])
    return {
        "line_number": arguments.get("line_number"),
        "status": status,
        "latency_ms": round(random.uniform(18, 85), 1),
        "packet_loss_percent": round(random.uniform(0.1, 2.4), 2),
        "recommended_action": random.choice(
            [
                "Power-cycle the modem and retest.",
                "Reset network settings on the device.",
                "Move closer to the router to improve signal.",
                "Technician visit scheduled if issue persists.",
            ]
        ),
    }


async def check_service_outage(arguments: Dict[str, Any]) -> Dict[str, Any]:
    affected = random.choice([True, False])
    return {
        "postal_code": arguments.get("postal_code"),
        "service": random.choice(["Mobile", "Home Internet", "Fiber"],),
        "impact": "Customers may experience slow speeds" if affected else "No widespread issues detected",
        "estimated_resolution": _random_date_within(2, future=True) if affected else None,
    }


async def get_account_balance(arguments: Dict[str, Any]) -> Dict[str, Any]:
    data_remaining_gb = round(random.uniform(1.5, 15.0), 2)
    minutes_remaining = random.randint(50, 1000)
    return {
        "account_id": arguments.get("account_id"),
        "billing_cycle_end": _random_date_within(9, future=True),
        "data_remaining_gb": data_remaining_gb,
        "minutes_remaining": minutes_remaining,
        "projected_overage_cost": _format_currency(random.uniform(10, 45)) if data_remaining_gb < 2 else "$0.00",
    }


async def modify_plan(arguments: Dict[str, Any]) -> Dict[str, Any]:
    available_plans = [
        {"name": "Unlimited Plus", "price": "$89.99"},
        {"name": "Family 50GB", "price": "$74.99"},
        {"name": "Starter 20GB", "price": "$59.99"},
    ]
    selected = random.choice(available_plans)
    return {
        "line_number": arguments.get("line_number"),
        "previous_plan": random.choice([plan for plan in available_plans if plan != selected]),
        "new_plan": selected,
        "effective_date": _random_date_within(3, future=True),
        "confirmation": f"PLN-{random.randint(100000, 999999)}",
    }


async def manage_sim(arguments: Dict[str, Any]) -> Dict[str, Any]:
    actions = ["Activated replacement SIM", "Provided PUK code", "Re-synced eSIM profile"]
    return {
        "line_number": arguments.get("line_number"),
        "action": random.choice(actions),
        "puk_code": f"{random.randint(10000000, 99999999)}" if arguments.get("needs_puk") else None,
        "last_activation": _random_date_within(45, future=False),
    }


async def process_payment(arguments: Dict[str, Any]) -> Dict[str, Any]:
    amount = arguments.get("amount")
    if amount is None:
        amount = round(random.uniform(45, 200), 2)
    return {
        "account_id": arguments.get("account_id"),
        "amount": _format_currency(float(amount)),
        "status": random.choice(["Success", "Pending review", "Scheduled"]),
        "confirmation_id": f"PMT{random.randint(1000000, 9999999)}",
        "processed_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


async def device_support(arguments: Dict[str, Any]) -> Dict[str, Any]:
    device = arguments.get("device_model") or random.choice([
        "Contoso Hub X2",
        "Galaxy S24",
        "iPhone 15",
        "Contoso Fiber Router",
    ])
    steps: List[str] = random.sample(
        [
            "Power-cycle the device for 30 seconds.",
            "Ensure the latest firmware is installed via the Contoso app.",
            "Reset network settings and reconnect to Wi-Fi.",
            "Check that the SIM tray is firmly closed.",
            "Perform a factory reset after backing up important data.",
        ],
        k=3,
    )
    return {
        "device_model": device,
        "issue_type": arguments.get("issue_type", "general"),
        "troubleshooting_steps": steps,
        "ticket_id": f"TCK-{random.randint(10000, 99999)}",
    }


async def schedule_installation(arguments: Dict[str, Any]) -> Dict[str, Any]:
    appointment_date = _random_date_within(14, future=True)
    return {
        "service_address": arguments.get("service_address"),
        "appointment_date": appointment_date,
        "time_slot": _random_time_slot(),
        "technician": random.choice(["A. Rahman", "L. Chen", "M. Smith", "R. Alvarez"]),
        "confirmation": f"INST-{random.randint(10000, 99999)}",
    }


async def manage_roaming(arguments: Dict[str, Any]) -> Dict[str, Any]:
    status = random.choice(["Enabled", "Disabled", "Temporarily Suspended"])
    return {
        "line_number": arguments.get("line_number"),
        "current_status": status,
        "zones_enabled": random.sample([
            "North America",
            "Europe",
            "Middle East",
            "Asia Pacific",
            "Latin America",
        ], k=random.randint(1, 3)),
        "next_review": _random_date_within(30, future=True),
    }


async def manage_value_added(arguments: Dict[str, Any]) -> Dict[str, Any]:
    services = ["VPN Protect", "5G Boost", "Streaming Pass", "Device Guard"]
    action = random.choice(["Added", "Removed", "Updated"])
    service_name = arguments.get("service_name") or random.choice(services)
    return {
        "service_name": service_name,
        "action": action,
        "monthly_cost": _format_currency(random.uniform(2.99, 14.99)),
        "effective_date": _random_date_within(5, future=True),
    }


async def update_account_info(arguments: Dict[str, Any]) -> Dict[str, Any]:
    fields = arguments.get("fields", ["email", "alternate_contact"])
    updated = [field for field in fields]
    return {
        "account_id": arguments.get("account_id"),
        "fields_updated": updated,
        "confirmation": f"UPD-{random.randint(1000, 9999)}",
        "notes": "Changes may take up to 15 minutes to reflect across systems.",
    }


async def report_lost_stolen(arguments: Dict[str, Any]) -> Dict[str, Any]:
    actions = ["Suspended line", "Blacklisted IMEI", "Issued replacement SIM"]
    return {
        "line_number": arguments.get("line_number"),
        "actions_taken": random.sample(actions, k=random.randint(1, len(actions))),
        "police_report_required": random.choice([True, False]),
        "replacement_order": f"REP-{random.randint(10000, 99999)}",
    }


async def cancel_service(arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "account_id": arguments.get("account_id"),
        "cancellation_date": _random_date_within(7, future=True),
        "final_bill_amount": _format_currency(random.uniform(25, 80)),
        "equipment_return_due": _random_date_within(14, future=True),
        "confirmation": f"CNL-{random.randint(10000, 99999)}",
    }


async def general_info(arguments: Dict[str, Any]) -> Dict[str, Any]:
    coverage_messages = [
        "5G coverage now reaches 92% of urban neighborhoods in your area.",
        "Fiber expansion is scheduled for your postal code next quarter.",
        "Customers near coastal regions may experience reduced speeds during storms.",
    ]
    promotions = [
        "Upgrade to Unlimited Plus and save $10/month for 12 months.",
        "Refer a friend and both receive a $50 bill credit.",
        "Bundle home internet with mobile service for an extra 100GB of hotspot data.",
    ]
    return {
        "topic": arguments.get("topic", "coverage"),
        "message": random.choice(coverage_messages),
        "promotion": random.choice(promotions),
        "last_updated": _random_date_within(10, future=False),
    }


async def renew_national_id(arguments: Dict[str, Any]) -> Dict[str, Any]:
    request_types = ["renewal", "replacement", "urgent replacement"]
    centers = ["Dubai Central", "Doha West Bay", "Riyadh Digital Hub", "Manama Seef"]
    return {
        "national_id": arguments.get("national_id"),
        "request_type": arguments.get("request_type", random.choice(request_types)),
        "status": random.choice(["Documents verified", "Pending biometrics", "Card in production"]),
        "expected_completion": _random_date_within(7, future=True),
        "pickup_center": random.choice(centers),
        "fee": _format_currency_local(random.uniform(50, 120)),
        "reference": _random_reference("ID"),
    }


async def process_passport_request(arguments: Dict[str, Any]) -> Dict[str, Any]:
    request_types = ["new", "renewal", "child renewal", "damaged replacement"]
    return {
        "applicant_id": arguments.get("applicant_id"),
        "request_type": arguments.get("request_type", random.choice(request_types)),
        "biometrics_appointment": _random_date_within(5, future=True),
        "passport_status": random.choice(["Under review", "Awaiting payment", "Ready for collection"]),
        "delivery_option": random.choice(["Courier", "Embassy pickup", "Service center pickup"]),
        "fee": _format_currency_local(random.uniform(200, 450)),
        "reference": _random_reference("PP"),
    }


async def manage_residency_permit(arguments: Dict[str, Any]) -> Dict[str, Any]:
    permit_actions = ["renewal", "extension", "dependent sponsorship", "cancellation"]
    return {
        "residency_file_number": arguments.get("residency_file_number"),
        "action": arguments.get("action", random.choice(permit_actions)),
        "status": random.choice(["Pending sponsor approval", "Medical exam scheduled", "Residence issued"]),
        "visa_expiry": _random_date_within(365, future=True),
        "payment_due": _format_currency_local(random.uniform(150, 350)),
        "next_steps": random.choice(
            [
                "Upload renewed health insurance certificate.",
                "Book biometrics appointment for dependents.",
                "Visit immigration counter with original passport.",
            ]
        ),
        "reference": _random_reference("RP"),
    }


async def handle_drivers_license(arguments: Dict[str, Any]) -> Dict[str, Any]:
    steps = [
        "Complete vision test at approved clinic.",
        "Upload residency visa copy.",
        "Settle outstanding traffic fines before renewal.",
        "Schedule road test via e-services portal.",
    ]
    return {
        "license_number": arguments.get("license_number"),
        "request_type": arguments.get("request_type", random.choice(["renewal", "conversion", "replacement"])),
        "status": random.choice(["Awaiting fee payment", "Processing", "Ready for collection"]),
        "validity_years": random.choice([1, 2, 5, 10]),
        "required_actions": random.sample(steps, k=3),
        "reference": _random_reference("DL"),
    }


async def manage_vehicle_registration(arguments: Dict[str, Any]) -> Dict[str, Any]:
    inspections = ["Passed smart inspection", "Pending insurance upload", "Inspection required"]
    return {
        "plate_number": arguments.get("plate_number"),
        "registration_status": random.choice(["Active", "Expiring", "Suspended"]),
        "next_renewal": _random_date_within(30, future=True),
        "inspection_status": random.choice(inspections),
        "renewal_fee": _format_currency_local(random.uniform(300, 650)),
        "reference": _random_reference("VR"),
    }


async def inquire_traffic_fines(arguments: Dict[str, Any]) -> Dict[str, Any]:
    violations = [
        {"violation": "Speeding", "amount": _format_currency_local(random.uniform(200, 600))},
        {"violation": "Illegal parking", "amount": _format_currency_local(random.uniform(150, 300))},
        {"violation": "Red light", "amount": _format_currency_local(random.uniform(800, 1200))},
        {"violation": "Toll gate unpaid", "amount": _format_currency_local(random.uniform(50, 150))},
    ]
    outstanding = random.sample(violations, k=random.randint(0, len(violations)))
    total_due = sum(
        float(item["amount"].split()[1].replace(",", "")) for item in outstanding
    ) if outstanding else 0.0
    return {
        "traffic_file_number": arguments.get("traffic_file_number"),
        "outstanding_fines": outstanding,
        "total_due": _format_currency_local(total_due),
        "payment_deadline": _random_date_within(14, future=True) if outstanding else None,
        "reference": _random_reference("TF"),
    }


async def manage_utility_account(arguments: Dict[str, Any]) -> Dict[str, Any]:
    services = ["electricity", "water", "district cooling"]
    return {
        "account_number": arguments.get("account_number"),
        "service_type": arguments.get("service_type", random.choice(services)),
        "current_bill_period": f"{datetime.utcnow():%B %Y}",
        "amount_due": _format_currency_local(random.uniform(200, 550)),
        "consumption_trend": random.choice(["Increased", "Stable", "Decreased"]),
        "autopay_enabled": random.choice([True, False]),
        "reference": _random_reference("UT"),
    }


async def schedule_health_services(arguments: Dict[str, Any]) -> Dict[str, Any]:
    services = ["health card renewal", "vaccination", "clinic appointment", "medical fitness test"]
    facilities = ["Primary Health Center", "Government Hospital", "Vaccination Drive Center", "Mobile Clinic"]
    return {
        "health_card_number": arguments.get("health_card_number"),
        "service": arguments.get("service", random.choice(services)),
        "appointment_date": _random_date_within(10, future=True),
        "time_slot": _random_time_slot(),
        "facility": random.choice(facilities),
        "status": random.choice(["Confirmed", "Pending payment", "Awaiting approval"]),
        "reference": _random_reference("HC"),
    }


async def request_official_documents(arguments: Dict[str, Any]) -> Dict[str, Any]:
    document_types = ["birth certificate", "marriage certificate", "degree attestation", "criminal status report"]
    delivery_methods = ["Digital PDF", "Courier delivery", "Service center pickup"]
    return {
        "document_type": arguments.get("document_type", random.choice(document_types)),
        "applicant_name": arguments.get("applicant_name"),
        "status": random.choice(["Under verification", "Ready for issuance", "Awaiting payment"]),
        "estimated_completion": _random_date_within(6, future=True),
        "delivery_method": random.choice(delivery_methods),
        "fee": _format_currency_local(random.uniform(40, 150)),
        "reference": _random_reference("DOC"),
    }


async def social_welfare_inquiry(arguments: Dict[str, Any]) -> Dict[str, Any]:
    programs = ["Housing allowance", "Disability support", "Retirement pension", "Low-income assistance"]
    statuses = ["Approved", "Pending review", "Additional documents required", "Disbursed"]
    return {
        "program": arguments.get("program", random.choice(programs)),
        "case_number": arguments.get("case_number", _random_reference("SW")),
        "status": random.choice(statuses),
        "monthly_amount": _format_currency_local(random.uniform(1500, 4500)),
        "next_payment_date": _random_date_within(20, future=True),
        "case_officer": random.choice(["Fatima Al-Mansouri", "Omar Al-Hassan", "Noura Al-Khalifa"]),
        "reference": _random_reference("SW"),
    }


async def housing_service_request(arguments: Dict[str, Any]) -> Dict[str, Any]:
    services = ["new housing application", "maintenance request", "land grant follow-up", "loan disbursement"]
    return {
        "application_id": arguments.get("application_id", _random_reference("HS")),
        "service": arguments.get("service", random.choice(services)),
        "status": random.choice(["Initial review", "Site inspection scheduled", "Approved", "Documents pending"]),
        "last_update": _random_date_within(15, future=False),
        "next_action": random.choice(
            [
                "Upload architectural drawings.",
                "Confirm site visit availability.",
                "Provide updated salary certificate.",
                "Await SMS notification for decision.",
            ]
        ),
        "reference": _random_reference("HS"),
    }


async def employment_labor_support(arguments: Dict[str, Any]) -> Dict[str, Any]:
    requests = [
        "public sector job application",
        "salary complaint",
        "domestic worker permit",
        "contract dispute",
    ]
    return {
        "transaction_id": arguments.get("transaction_id", _random_reference("LB")),
        "request_type": arguments.get("request_type", random.choice(requests)),
        "status": random.choice(["Submitted", "Escalated", "Resolved", "Awaiting employer response"]),
        "assigned_department": random.choice(["Labor Relations", "Recruitment Center", "Wage Protection Unit"]),
        "next_steps": random.choice(
            [
                "Upload employment contract copy.",
                "Provide bank statement for last 3 months.",
                "Schedule appearance at labor office.",
                "Monitor SMS for case updates.",
            ]
        ),
        "reference": _random_reference("LB"),
    }


async def issue_police_clearance(arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "national_id": arguments.get("national_id"),
        "status": random.choice(["Biometrics verified", "Fingerprint pending", "Certificate issued"]),
        "delivery_method": random.choice(["Download PDF", "Courier", "Police HQ pickup"]),
        "processing_time_days": random.randint(2, 7),
        "fee": _format_currency_local(random.uniform(50, 120)),
        "reference": _random_reference("PCC"),
    }


async def report_incident(arguments: Dict[str, Any]) -> Dict[str, Any]:
    incident_types = ["minor traffic accident", "lost item", "noise complaint", "property damage"]
    return {
        "incident_type": arguments.get("incident_type", random.choice(incident_types)),
        "report_status": random.choice(["Awaiting review", "Filed", "Requires additional evidence"]),
        "supporting_documents": arguments.get("supporting_documents", []),
        "submission_time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "follow_up_required": random.choice([True, False]),
        "reference": _random_reference("INC"),
    }


async def submit_public_feedback(arguments: Dict[str, Any]) -> Dict[str, Any]:
    categories = ["municipality", "consumer protection", "transport", "utilities", "digital services"]
    return {
        "category": arguments.get("category", random.choice(categories)),
        "subject": arguments.get("subject", "General feedback"),
        "priority": random.choice(["Normal", "High", "Urgent"]),
        "ticket_status": random.choice(["Logged", "Forwarded", "Resolved", "Closed"]),
        "response_time_estimate": _random_date_within(5, future=True),
        "reference": _random_reference("FB"),
    }


async def handle_digital_access_issue(arguments: Dict[str, Any]) -> Dict[str, Any]:
    channels = ["mobile_app", "online_banking", "token_device"]
    return {
        "customer_id": arguments.get("customer_id", _random_reference("CUS")),
        "preferred_channel": arguments.get("channel", random.choice(channels)),
        "issue": random.choice([
            "locked_account",
            "forgotten_password",
            "two_factor_failure",
        ]),
        "status": random.choice(["Reset initiated", "Security verification required", "Resolved"]),
        "resolution_steps": [
            "Verify identity via SMS challenge.",
            "Reset credentials and confirm login.",
            "Provide guidance on trusted devices.",
        ],
    }


async def inquiry_account_activity(arguments: Dict[str, Any]) -> Dict[str, Any]:
    balances = {
        "current": _format_currency(random.uniform(500, 5000)),
        "available": _format_currency(random.uniform(300, 4500)),
        "pending_transactions": random.randint(0, 4),
    }
    recent_transactions = [
        {
            "date": _random_date_within(5, future=False),
            "description": random.choice([
                "POS Contoso Market",
                "Salary Credit",
                "Utility Payment",
                "ATM Withdrawal",
            ]),
            "amount": _format_currency(random.uniform(-120, 850)),
        }
        for _ in range(random.randint(2, 5))
    ]
    return {
        "account_id": arguments.get("account_id"),
        "balances": balances,
        "recent_transactions": recent_transactions,
        "next_statement_date": _random_date_within(15, future=True),
    }


async def support_fund_transfer(arguments: Dict[str, Any]) -> Dict[str, Any]:
    transfer_types = ["SEPA", "SWIFT", "domestic", "standing_order"]
    status = random.choice(["Processing", "Completed", "Pending beneficiary verification"])
    return {
        "transfer_reference": _random_reference("FT"),
        "transfer_type": arguments.get("transfer_type", random.choice(transfer_types)),
        "amount": _format_currency_local(random.uniform(100, 5000), arguments.get("currency", "EUR")),
        "beneficiary": arguments.get("beneficiary", "Primary savings"),
        "status": status,
        "estimated_completion": _random_date_within(2, future=True) if status != "Completed" else datetime.utcnow().strftime("%Y-%m-%d"),
    }


async def report_card_loss(arguments: Dict[str, Any]) -> Dict[str, Any]:
    card_types = ["debit", "credit", "prepaid"]
    return {
        "card_type": arguments.get("card_type", random.choice(card_types)),
        "card_last4": arguments.get("card_last4", f"{random.randint(1000, 9999)}"),
        "status": random.choice(["Temporarily blocked", "Cancelled", "Replacement issued"]),
        "reported_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "replacement_eta": _random_date_within(5, future=True),
        "incident_reference": _random_reference("CARD"),
    }


async def resolve_card_status_issue(arguments: Dict[str, Any]) -> Dict[str, Any]:
    issues = ["activation", "pin_reset", "travel_notification", "fraud_block"]
    return {
        "card_last4": arguments.get("card_last4", f"{random.randint(1000, 9999)}"),
        "issue_type": arguments.get("issue_type", random.choice(issues)),
        "verification_steps": random.sample([
            "Confirm recent transactions with customer.",
            "Send OTP for verification.",
            "Validate travel dates and destinations.",
            "Generate new PIN and courier details.",
        ], k=2),
        "resolution_status": random.choice(["Resolved", "Pending customer action", "Escalated to fraud team"]),
        "reference": _random_reference("CARD"),
    }


async def handle_fraud_alert(arguments: Dict[str, Any]) -> Dict[str, Any]:
    suspicious_transactions = [
        {
            "date": _random_date_within(1, future=False),
            "merchant": random.choice(["Global Airlines", "Online Retail", "Fuel Station", "Subscription Service"]),
            "amount": _format_currency_local(random.uniform(50, 1500)),
        }
        for _ in range(random.randint(1, 3))
    ]
    return {
        "alert_id": _random_reference("FRD"),
        "customer_id": arguments.get("customer_id", _random_reference("CUS")),
        "risk_level": random.choice(["High", "Medium", "Low"]),
        "transactions_reviewed": suspicious_transactions,
        "account_status": random.choice(["Frozen", "Monitoring", "Restored"]),
        "next_steps": random.choice([
            "Await customer affidavit.",
            "Reissue card and credentials.",
            "Escalate to investigations unit.",
        ]),
    }


async def dispute_transaction(arguments: Dict[str, Any]) -> Dict[str, Any]:
    dispute_reasons = [
        "duplicate_charge",
        "goods_not_received",
        "service_not_as_described",
        "unauthorized_transaction",
    ]
    return {
        "dispute_id": _random_reference("DSP"),
        "transaction_date": arguments.get("transaction_date", _random_date_within(30, future=False)),
        "merchant": arguments.get("merchant", random.choice(["Contoso Electronics", "Fabrikam Travel", "Wide World Importers"])),
        "amount": _format_currency_local(random.uniform(20, 1200)),
        "reason": arguments.get("reason", random.choice(dispute_reasons)),
        "provisional_credit": random.choice([True, False]),
        "expected_resolution": _random_date_within(45, future=True),
    }


async def inquire_fees(arguments: Dict[str, Any]) -> Dict[str, Any]:
    fees = [
        ("monthly_maintenance", random.uniform(5, 20)),
        ("foreign_transaction", random.uniform(3, 15)),
        ("overdraft", random.uniform(20, 45)),
    ]
    fee_type, amount = random.choice(fees)
    return {
        "fee_type": arguments.get("fee_type", fee_type),
        "amount": _format_currency_local(amount, arguments.get("currency", "EUR")),
        "charged_on": _random_date_within(7, future=False),
        "waiver_status": random.choice(["Approved", "Denied", "Pending review"]),
        "notes": "Fee review completed with supervisor" if random.choice([True, False]) else "Eligible for goodwill credit",
    }


async def loan_mortgage_assistance(arguments: Dict[str, Any]) -> Dict[str, Any]:
    products = ["mortgage", "auto_loan", "personal_loan", "business_loan"]
    product_type = arguments.get("product_type", random.choice(products))
    return {
        "loan_id": arguments.get("loan_id", _random_reference("LN")),
        "product_type": product_type,
        "outstanding_balance": _format_currency_local(random.uniform(5000, 250000)),
        "interest_rate_percent": round(random.uniform(2.1, 6.8), 2),
        "available_options": random.sample([
            "Offer payment deferral",
            "Provide settlement figure",
            "Discuss refinance options",
            "Escalate to relationship manager",
        ], k=3),
        "next_payment_due": _random_date_within(20, future=True),
    }


async def resolve_funds_availability(arguments: Dict[str, Any]) -> Dict[str, Any]:
    deposit_types = ["salary", "check", "international_wire", "cash_deposit"]
    status = random.choice(["Posted", "Pending verification", "On hold"])
    return {
        "deposit_type": arguments.get("deposit_type", random.choice(deposit_types)),
        "amount": _format_currency_local(random.uniform(250, 15000)),
        "expected_availability": _random_date_within(3, future=True) if status != "Posted" else datetime.utcnow().strftime("%Y-%m-%d"),
        "status": status,
        "escalation_reference": _random_reference("FND"),
        "notes": random.choice([
            "Awaiting employer file confirmation.",
            "Check requires manual verification.",
            "ATM reconciliation in progress.",
        ]),
    }


async def update_account_maintenance(arguments: Dict[str, Any]) -> Dict[str, Any]:
    requested_changes = arguments.get("changes", ["address_update", "email_update"])
    return {
        "account_id": arguments.get("account_id"),
        "changes_applied": requested_changes,
        "support_documents_required": random.sample([
            "Proof of address",
            "Identification copy",
            "Corporate resolution",
        ], k=random.randint(0, 2)),
        "status": random.choice(["Completed", "Pending documents", "In progress"]),
        "reference": _random_reference("ACM"),
    }


async def explore_new_products(arguments: Dict[str, Any]) -> Dict[str, Any]:
    interests = ["savings_account", "credit_card", "investment_plan", "insurance_bundle"]
    return {
        "customer_id": arguments.get("customer_id", _random_reference("CUS")),
        "product_interest": arguments.get("product_interest", random.choice(interests)),
        "recommended_products": random.sample([
            "High-yield savings 3.2% APY",
            "Premium travel credit card",
            "Balanced mutual fund portfolio",
            "Comprehensive protection bundle",
        ], k=2),
        "next_steps": random.choice([
            "Schedule advisor callback",
            "Send digital application link",
            "Visit branch for KYC",
        ]),
        "reference": _random_reference("PRD"),
    }


async def escalate_complaint(arguments: Dict[str, Any]) -> Dict[str, Any]:
    priorities = ["High", "Medium", "Critical"]
    return {
        "complaint_id": arguments.get("complaint_id", _random_reference("CMP")),
        "issue_category": arguments.get("issue_category", random.choice(["fees", "service", "technical", "branch_experience"])),
        "priority": random.choice(priorities),
        "assigned_team": random.choice(["Customer Advocacy", "Regulatory Response", "Branch Operations"]),
        "expected_follow_up": _random_date_within(7, future=True),
        "status": random.choice(["Acknowledged", "In investigation", "Resolved"]),
    }


async def merchant_services_support(arguments: Dict[str, Any]) -> Dict[str, Any]:
    issues = ["terminal_offline", "settlement_delay", "gateway_error", "chargeback_spike"]
    return {
        "merchant_id": arguments.get("merchant_id", _random_reference("MER")),
        "issue_type": arguments.get("issue_type", random.choice(issues)),
        "terminal_status": random.choice(["Online", "Offline", "Reboot required"]),
        "last_settlement": _random_date_within(2, future=False),
        "resolution_target": _random_date_within(1, future=True),
        "specialist_assigned": random.choice(["POS Support", "Payments Operations", "Risk Monitoring"]),
    }


async def corporate_platform_support(arguments: Dict[str, Any]) -> Dict[str, Any]:
    modules = ["bulk_payments", "user_administration", "trade_finance", "cash_management"]
    return {
        "company_id": arguments.get("company_id", _random_reference("CORP")),
        "platform_module": arguments.get("platform_module", random.choice(modules)),
        "issue": random.choice([
            "token_sync_failure",
            "approval_workflow_error",
            "FX booking limits",
            "user_role_assignment",
        ]),
        "status": random.choice(["Resolved", "Pending SME review", "Escalated to engineering"]),
        "next_steps": random.choice([
            "Provide updated signature mandate.",
            "Run security token reset.",
            "Arrange treasury advisor session.",
        ]),
        "reference": _random_reference("CORP"),
    }


TOOLS_REGISTRY: Dict[str, Dict[str, Any]] = {
    "get_billing_info": {
        "definition": {
            "type": "function",
            "name": "get_billing_info",
            "description": "Retrieve recent bills, charges, or disputes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string", "description": "Customer account identifier."}
                },
                "required": ["account_id"],
            },
        },
        "executor": get_billing_info,
    },
    "check_network_connectivity": {
        "definition": {
            "type": "function",
            "name": "check_network_connectivity",
            "description": "Test or report connectivity issues.",
            "parameters": {
                "type": "object",
                "properties": {
                    "line_number": {"type": "string", "description": "Line or service number to test."}
                },
                "required": ["line_number"],
            },
        },
        "executor": check_network_connectivity,
    },
    "check_service_outage": {
        "definition": {
            "type": "function",
            "name": "check_service_outage",
            "description": "Look up area-wide outages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "postal_code": {"type": "string", "description": "Postal code to investigate."}
                },
                "required": ["postal_code"],
            },
        },
        "executor": check_service_outage,
    },
    "get_account_balance": {
        "definition": {
            "type": "function",
            "name": "get_account_balance",
            "description": "Provide balance or data usage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string", "description": "Customer account identifier."}
                },
                "required": ["account_id"],
            },
        },
        "executor": get_account_balance,
    },
    "modify_plan": {
        "definition": {
            "type": "function",
            "name": "modify_plan",
            "description": "Change or upgrade/downgrade plans.",
            "parameters": {
                "type": "object",
                "properties": {
                    "line_number": {"type": "string", "description": "Line to modify."}
                },
                "required": ["line_number"],
            },
        },
        "executor": modify_plan,
    },
    "manage_sim": {
        "definition": {
            "type": "function",
            "name": "manage_sim",
            "description": "Activate/replace SIM or provide PUK.",
            "parameters": {
                "type": "object",
                "properties": {
                    "line_number": {"type": "string"},
                    "needs_puk": {"type": "boolean"},
                },
                "required": ["line_number"],
            },
        },
        "executor": manage_sim,
    },
    "process_payment": {
        "definition": {
            "type": "function",
            "name": "process_payment",
            "description": "Take or confirm payments/recharges.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string"},
                    "amount": {"type": "number", "description": "Payment amount in USD."},
                },
                "required": ["account_id"],
            },
        },
        "executor": process_payment,
    },
    "device_support": {
        "definition": {
            "type": "function",
            "name": "device_support",
            "description": "Troubleshoot phones, routers, or modems.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_model": {"type": "string"},
                    "issue_type": {"type": "string"},
                },
            },
        },
        "executor": device_support,
    },
    "schedule_installation": {
        "definition": {
            "type": "function",
            "name": "schedule_installation",
            "description": "New service setup or appointments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_address": {"type": "string"},
                },
                "required": ["service_address"],
            },
        },
        "executor": schedule_installation,
    },
    "manage_roaming": {
        "definition": {
            "type": "function",
            "name": "manage_roaming",
            "description": "Enable/disable roaming, troubleshoot abroad.",
            "parameters": {
                "type": "object",
                "properties": {
                    "line_number": {"type": "string"},
                },
                "required": ["line_number"],
            },
        },
        "executor": manage_roaming,
    },
    "manage_value_added": {
        "definition": {
            "type": "function",
            "name": "manage_value_added",
            "description": "Add/remove optional services/features.",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {"type": "string"},
                },
            },
        },
        "executor": manage_value_added,
    },
    "update_account_info": {
        "definition": {
            "type": "function",
            "name": "update_account_info",
            "description": "Change contact details or reset password.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string"},
                    "fields": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Fields to update.",
                    },
                },
                "required": ["account_id"],
            },
        },
        "executor": update_account_info,
    },
    "report_lost_stolen": {
        "definition": {
            "type": "function",
            "name": "report_lost_stolen",
            "description": "Suspend/blacklist lost or stolen devices.",
            "parameters": {
                "type": "object",
                "properties": {
                    "line_number": {"type": "string"},
                },
                "required": ["line_number"],
            },
        },
        "executor": report_lost_stolen,
    },
    "cancel_service": {
        "definition": {
            "type": "function",
            "name": "cancel_service",
            "description": "Terminate or port service.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string"},
                },
                "required": ["account_id"],
            },
        },
        "executor": cancel_service,
    },
    "general_info": {
        "definition": {
            "type": "function",
            "name": "general_info",
            "description": "Provide coverage details, promotions, FAQs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                },
            },
        },
        "executor": general_info,
    },
    "renew_national_id": {
        "definition": {
            "type": "function",
            "name": "renew_national_id",
            "description": "Assist with national ID renewal or replacement requests.",
            "parameters": {
                "type": "object",
                "properties": {
                    "national_id": {"type": "string", "description": "National ID number."},
                    "request_type": {
                        "type": "string",
                        "description": "renewal | replacement | urgent replacement",
                    },
                },
                "required": ["national_id"],
            },
        },
        "executor": renew_national_id,
    },
    "process_passport_request": {
        "definition": {
            "type": "function",
            "name": "process_passport_request",
            "description": "Handle passport issuance or renewal inquiries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_id": {"type": "string", "description": "Applicant identifier."},
                    "request_type": {"type": "string", "description": "Request classification."},
                },
                "required": ["applicant_id"],
            },
        },
        "executor": process_passport_request,
    },
    "manage_residency_permit": {
        "definition": {
            "type": "function",
            "name": "manage_residency_permit",
            "description": "Support visa and residency permit services for residents and dependents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "residency_file_number": {"type": "string", "description": "Immigration file number."},
                    "action": {
                        "type": "string",
                        "description": "renewal | extension | dependent sponsorship | cancellation",
                    },
                },
                "required": ["residency_file_number"],
            },
        },
        "executor": manage_residency_permit,
    },
    "handle_drivers_license": {
        "definition": {
            "type": "function",
            "name": "handle_drivers_license",
            "description": "Provide guidance on driver license applications or renewals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "license_number": {"type": "string", "description": "Driver license number."},
                    "request_type": {
                        "type": "string",
                        "description": "renewal | conversion | replacement",
                    },
                },
                "required": ["license_number"],
            },
        },
        "executor": handle_drivers_license,
    },
    "manage_vehicle_registration": {
        "definition": {
            "type": "function",
            "name": "manage_vehicle_registration",
            "description": "Manage vehicle registration renewals and status checks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "plate_number": {"type": "string", "description": "Vehicle plate number."},
                },
                "required": ["plate_number"],
            },
        },
        "executor": manage_vehicle_registration,
    },
    "inquire_traffic_fines": {
        "definition": {
            "type": "function",
            "name": "inquire_traffic_fines",
            "description": "Summarize outstanding traffic violations and payment deadlines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "traffic_file_number": {
                        "type": "string",
                        "description": "Traffic file or plate identifier.",
                    }
                },
                "required": ["traffic_file_number"],
            },
        },
        "executor": inquire_traffic_fines,
    },
    "manage_utility_account": {
        "definition": {
            "type": "function",
            "name": "manage_utility_account",
            "description": "Handle electricity or water billing inquiries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_number": {"type": "string", "description": "Utility account number."},
                    "service_type": {
                        "type": "string",
                        "description": "electricity | water | district cooling",
                    },
                },
                "required": ["account_number"],
            },
        },
        "executor": manage_utility_account,
    },
    "schedule_health_services": {
        "definition": {
            "type": "function",
            "name": "schedule_health_services",
            "description": "Assist with government health card renewals or appointments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "health_card_number": {"type": "string", "description": "Health card identifier."},
                    "service": {"type": "string", "description": "Requested health service."},
                },
                "required": ["health_card_number"],
            },
        },
        "executor": schedule_health_services,
    },
    "request_official_documents": {
        "definition": {
            "type": "function",
            "name": "request_official_documents",
            "description": "Track civil document issuance and attestations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "document_type": {"type": "string", "description": "Type of document requested."},
                    "applicant_name": {"type": "string", "description": "Full name of applicant."},
                },
            },
        },
        "executor": request_official_documents,
    },
    "social_welfare_inquiry": {
        "definition": {
            "type": "function",
            "name": "social_welfare_inquiry",
            "description": "Answer questions on social welfare and pension programs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "program": {"type": "string", "description": "Name of benefit program."},
                    "case_number": {"type": "string", "description": "Case reference, if available."},
                },
            },
        },
        "executor": social_welfare_inquiry,
    },
    "housing_service_request": {
        "definition": {
            "type": "function",
            "name": "housing_service_request",
            "description": "Provide status on citizen housing and land applications.",
            "parameters": {
                "type": "object",
                "properties": {
                    "application_id": {
                        "type": "string",
                        "description": "Housing application reference.",
                    },
                    "service": {"type": "string", "description": "Type of housing service."},
                },
            },
        },
        "executor": housing_service_request,
    },
    "employment_labor_support": {
        "definition": {
            "type": "function",
            "name": "employment_labor_support",
            "description": "Assist with employment, labor complaints, and domestic worker permits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "string", "description": "Labor transaction identifier."},
                    "request_type": {"type": "string", "description": "Type of employment or labor request."},
                },
            },
        },
        "executor": employment_labor_support,
    },
    "issue_police_clearance": {
        "definition": {
            "type": "function",
            "name": "issue_police_clearance",
            "description": "Provide updates on police clearance (good conduct) certificates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "national_id": {"type": "string", "description": "ID linked to clearance request."},
                },
                "required": ["national_id"],
            },
        },
        "executor": issue_police_clearance,
    },
    "report_incident": {
        "definition": {
            "type": "function",
            "name": "report_incident",
            "description": "File or follow up on civil/police incident reports.",
            "parameters": {
                "type": "object",
                "properties": {
                    "incident_type": {"type": "string", "description": "Incident classification."},
                    "supporting_documents": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional supporting files.",
                    },
                },
            },
        },
        "executor": report_incident,
    },
    "submit_public_feedback": {
        "definition": {
            "type": "function",
            "name": "submit_public_feedback",
            "description": "Record citizen complaints or service feedback.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Feedback category."},
                    "subject": {"type": "string", "description": "Short summary of feedback."},
                },
            },
        },
        "executor": submit_public_feedback,
    },
    "handle_digital_access_issue": {
        "definition": {
            "type": "function",
            "name": "handle_digital_access_issue",
            "description": "Assist customers with online or mobile banking access problems.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "string", "description": "Bank customer identifier."},
                    "channel": {"type": "string", "description": "Preferred digital channel."},
                },
            },
        },
        "executor": handle_digital_access_issue,
    },
    "inquiry_account_activity": {
        "definition": {
            "type": "function",
            "name": "inquiry_account_activity",
            "description": "Summarize account balances and recent transactions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string", "description": "Bank account identifier."},
                },
                "required": ["account_id"],
            },
        },
        "executor": inquiry_account_activity,
    },
    "support_fund_transfer": {
        "definition": {
            "type": "function",
            "name": "support_fund_transfer",
            "description": "Provide status or assistance with fund transfers and payments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transfer_type": {"type": "string", "description": "Transfer method (SEPA, SWIFT, etc.)."},
                    "beneficiary": {"type": "string", "description": "Beneficiary name or label."},
                    "currency": {"type": "string", "description": "ISO currency code."},
                },
            },
        },
        "executor": support_fund_transfer,
    },
    "report_card_loss": {
        "definition": {
            "type": "function",
            "name": "report_card_loss",
            "description": "Block and replace lost or stolen payment cards.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_type": {"type": "string", "description": "Type of card (debit, credit)."},
                    "card_last4": {"type": "string", "description": "Last four digits of card."},
                },
                "required": ["card_last4"],
            },
        },
        "executor": report_card_loss,
    },
    "resolve_card_status_issue": {
        "definition": {
            "type": "function",
            "name": "resolve_card_status_issue",
            "description": "Assist with card declines, blocks, and activation questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_last4": {"type": "string", "description": "Last four digits of card."},
                    "issue_type": {"type": "string", "description": "activation | pin_reset | travel_notification | fraud_block"},
                },
                "required": ["card_last4"],
            },
        },
        "executor": resolve_card_status_issue,
    },
    "handle_fraud_alert": {
        "definition": {
            "type": "function",
            "name": "handle_fraud_alert",
            "description": "Manage fraud alerts and secure customer accounts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "string", "description": "Bank customer identifier."},
                },
            },
        },
        "executor": handle_fraud_alert,
    },
    "dispute_transaction": {
        "definition": {
            "type": "function",
            "name": "dispute_transaction",
            "description": "File and track transaction disputes or chargebacks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_date": {"type": "string", "description": "Transaction date (YYYY-MM-DD)."},
                    "merchant": {"type": "string", "description": "Merchant name."},
                    "reason": {"type": "string", "description": "Dispute reason."},
                },
            },
        },
        "executor": dispute_transaction,
    },
    "inquire_fees": {
        "definition": {
            "type": "function",
            "name": "inquire_fees",
            "description": "Explain service fees or request waivers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fee_type": {"type": "string", "description": "Type of fee in question."},
                    "currency": {"type": "string", "description": "ISO currency code."},
                },
            },
        },
        "executor": inquire_fees,
    },
    "loan_mortgage_assistance": {
        "definition": {
            "type": "function",
            "name": "loan_mortgage_assistance",
            "description": "Handle loan or mortgage servicing requests.",
            "parameters": {
                "type": "object",
                "properties": {
                    "loan_id": {"type": "string", "description": "Loan identifier."},
                    "product_type": {"type": "string", "description": "Loan product type."},
                },
            },
        },
        "executor": loan_mortgage_assistance,
    },
    "resolve_funds_availability": {
        "definition": {
            "type": "function",
            "name": "resolve_funds_availability",
            "description": "Investigate deposit issues and funds availability.",
            "parameters": {
                "type": "object",
                "properties": {
                    "deposit_type": {"type": "string", "description": "Type of deposit."},
                },
            },
        },
        "executor": resolve_funds_availability,
    },
    "update_account_maintenance": {
        "definition": {
            "type": "function",
            "name": "update_account_maintenance",
            "description": "Assist with routine account maintenance updates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "string", "description": "Bank account identifier."},
                    "changes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Requested account changes.",
                    },
                },
                "required": ["account_id"],
            },
        },
        "executor": update_account_maintenance,
    },
    "explore_new_products": {
        "definition": {
            "type": "function",
            "name": "explore_new_products",
            "description": "Guide customers on new banking products or services.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "string", "description": "Bank customer identifier."},
                    "product_interest": {"type": "string", "description": "Product category of interest."},
                },
            },
        },
        "executor": explore_new_products,
    },
    "escalate_complaint": {
        "definition": {
            "type": "function",
            "name": "escalate_complaint",
            "description": "Log customer complaints and forward to specialist teams.",
            "parameters": {
                "type": "object",
                "properties": {
                    "complaint_id": {"type": "string", "description": "Complaint reference."},
                    "issue_category": {"type": "string", "description": "fees | service | technical | branch_experience"},
                },
            },
        },
        "executor": escalate_complaint,
    },
    "merchant_services_support": {
        "definition": {
            "type": "function",
            "name": "merchant_services_support",
            "description": "Support business clients with merchant services and payment processing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "merchant_id": {"type": "string", "description": "Merchant identifier."},
                    "issue_type": {"type": "string", "description": "Merchant service issue."},
                },
            },
        },
        "executor": merchant_services_support,
    },
    "corporate_platform_support": {
        "definition": {
            "type": "function",
            "name": "corporate_platform_support",
            "description": "Assist SMEs and corporates with online banking platform issues.",
            "parameters": {
                "type": "object",
                "properties": {
                    "company_id": {"type": "string", "description": "Company identifier."},
                    "platform_module": {"type": "string", "description": "Affected module."},
                },
            },
        },
        "executor": corporate_platform_support,
    },
}


@app.get("/api/tools")
async def list_tools() -> Dict[str, Any]:
    """Return tool definitions for the frontend to register with the realtime session."""
    return {
        "tools": [tool["definition"] for tool in TOOLS_REGISTRY.values()],
        "tool_choice": "auto",
    }


@app.post("/api/session", response_model=SessionResponse)
async def create_session(request: SessionRequest) -> SessionResponse:
    """Issue an ephemeral key suitable for establishing a WebRTC session."""
    deployment = request.deployment or DEFAULT_DEPLOYMENT
    voice = request.voice or DEFAULT_VOICE

    payload = {"model": deployment, "voice": voice}
    headers = await _get_auth_headers()

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(REALTIME_SESSION_URL, headers=headers, json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:  # pragma: no cover - network specific
            logger.exception("Failed to create realtime session: %s", exc)
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)

    data = response.json()
    ephemeral_key = data.get("client_secret", {}).get("value")
    session_id = data.get("id")
    if not ephemeral_key or not session_id:
        raise HTTPException(status_code=500, detail="Malformed session response from Azure")

    return SessionResponse(
        session_id=session_id,
        ephemeral_key=ephemeral_key,
        webrtc_url=WEBRTC_URL,
        deployment=deployment,
        voice=voice,
    )


@app.post("/api/function-call", response_model=FunctionCallResponse)
async def execute_function(request: FunctionCallRequest) -> FunctionCallResponse:
    """Execute a tool requested by the model, return its structured output, and
    display a rich debug pane (if 'rich' is installed) with name, arguments, and result.
    """
    tool = TOOLS_REGISTRY.get(request.name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Unknown function '{request.name}'")

    arguments = _parse_arguments(request.arguments)
    executor: ToolExecutor = tool["executor"]

    result = executor(arguments)
    if inspect.isawaitable(result):
        result = await result

    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Function executor must return a dict")

    # Rich debug output (best-effort; falls back silently if rich not available)
    try:

        console = Console()

        table = Table.grid(padding=(0, 1))
        table.add_column(justify="right", style="bold cyan")
        table.add_column(style="white")

        table.add_row("Function:", request.name)
        table.add_row("Call ID:", request.call_id)

        # Arguments block
        try:
            args_json = RichJSON.from_data(arguments)
        except Exception:
            args_json = str(arguments)

        # Result block
        try:
            result_json = RichJSON.from_data(result)
        except Exception:
            result_json = str(result)

        console.print(
            Panel.fit(
                table,
                title="Function Call",
                border_style="magenta",
            )
        )
        console.print(Panel(args_json, title="Arguments", border_style="cyan"))
        console.print(Panel(result_json, title="Result", border_style="green"))
    except Exception as e:
        # Swallow any rich / rendering errors to avoid impacting API behavior
        console.print(f"Exception: {e}")

    return FunctionCallResponse(call_id=request.call_id, output=result)


@app.get("/healthz")
async def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await credential.close()


if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")
else:
    logger.warning("Frontend build directory not found at %s; React app will not be served.", FRONTEND_DIST_DIR)
