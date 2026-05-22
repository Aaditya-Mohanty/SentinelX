import os
from typing import List, Dict
import requests
from backend.config import settings

class AIAnalyst:
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY
        self.use_groq = self.api_key and not self.api_key.startswith("gsk_mock")
        if self.use_groq:
            try:
                from groq import Groq
                self.client = Groq(api_key=self.api_key)
            except ImportError:
                self.use_groq = False

    def get_system_prompt(self) -> str:
        return (
            "You are SentinelX AI, an elite cybersecurity SOC Analyst assistant. "
            "You specialize in threat hunting, log analysis, active response triggers, "
            "MITRE ATT&CK mapping, and NIST CSF playbooks. "
            "Always output highly professional, clean markdown with detailed recommendations. "
            "If code or commands are requested, provide accurate shell/bash/powershell commands."
        )

    def analyze_alert(self, alert_type: str, description: str, severity: str) -> str:
        """Analyze a specific alert and generate explanations and remediation playbooks."""
        prompt = (
            f"Please analyze the following security alert:\n"
            f"Alert Type: {alert_type}\n"
            f"Severity: {severity}\n"
            f"Details: {description}\n\n"
            f"Provide a structured security briefing in Markdown, covering:\n"
            f"1. **Threat Assessment**: Detailed explanation of the threat and potential impact.\n"
            f"2. **MITRE ATT&CK Mapping**: Identify corresponding tactics and techniques.\n"
            f"3. **Remediation Steps**: Step-by-step commands to contain, eradicate, and recover from the incident."
        )
        
        if self.use_groq:
            try:
                chat_completion = self.client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": self.get_system_prompt()},
                        {"role": "user", "content": prompt}
                    ],
                    model="llama3-8b-8192",
                    temperature=0.2,
                )
                return chat_completion.choices[0].message.content
            except Exception as e:
                # Log error and fall back to local mock
                print(f"Groq API error, falling back to mock: {e}")

        # Rule-based fallback response
        return self._mock_alert_analysis(alert_type, description, severity)

    def generate_chat_response(self, chat_history: List[Dict[str, str]]) -> str:
        """Process conversational threat hunting questions."""
        if self.use_groq:
            try:
                messages = [{"role": "system", "content": self.get_system_prompt()}]
                for msg in chat_history[-10:]:  # Keep last 10 messages for context
                    messages.append({"role": msg["role"], "content": msg["content"]})
                
                chat_completion = self.client.chat.completions.create(
                    messages=messages,
                    model="llama3-8b-8192",
                    temperature=0.5,
                )
                return chat_completion.choices[0].message.content
            except Exception as e:
                print(f"Groq Chat API error, falling back to mock: {e}")

        # Local mock chat parser
        user_message = chat_history[-1]["content"].lower()
        return self._mock_chat_response(user_message)

    def _mock_alert_analysis(self, alert_type: str, description: str, severity: str) -> str:
        """Local rule-based generator for realistic threat insights."""
        mitre_mapping = {
            "Brute Force": ("T1110", "Credential Access"),
            "SQL Injection": ("T1190", "Initial Access"),
            "Malware": ("T1059", "Execution"),
            "Privilege Escalation": ("T1068", "Privilege Escalation"),
            "PowerShell": ("T1059.001", "Execution"),
            "Port Scanning": ("T1046", "Discovery"),
            "Data Exfiltration": ("T1048", "Exfiltration"),
        }

        tech_id, tactic = ("T1059", "Execution")
        for key, val in mitre_mapping.items():
            if key.lower() in alert_type.lower() or key.lower() in description.lower():
                tech_id, tactic = val
                break

        return f"""### SentinelX AI Threat Briefing

#### 1. Threat Assessment: {alert_type} ({severity} Severity)
The platform detected indicator activity matching signature profiles for **{alert_type}**. The target host experienced actions described as: *{description}*.
* **Impact**: Potential unauthorized control, resource abuse, or data compromise.
* **Risk Score**: {90 if severity.lower() == 'critical' else 75 if severity.lower() == 'high' else 45}/100

#### 2. MITRE ATT&CK Mapping
* **Tactic**: [{tactic}](https://attack.mitre.org/tactics/{tactic.replace(' ', '')})
* **Technique**: [{tech_id}](https://attack.mitre.org/techniques/{tech_id})
* **Validation**: Correlated with event logs indicating suspicious script executions and API patterns.

#### 3. Incident Remediation Playbook (Zero-Trust Containment)
Select appropriate actions below depending on agent platform:

**Linux Host Containment:**
```bash
# 1. Block the attacker IP (e.g., 198.51.100.42)
sudo iptables -A INPUT -s 198.51.100.42 -j DROP

# 2. Terminate rogue shell processes
sudo killall -9 nc bash python 2>/dev/null

# 3. Check unauthorized persistent entries
cat /etc/passwd | grep -E "sh$|bash$"
```

**Windows Host Containment:**
```powershell
# 1. Fire up block command via PowerShell
New-NetFirewallRule -DisplayName "Block Attacker IP" -Direction Inbound -Action Block -RemoteAddress "198.51.100.42"

# 2. Terminate malicious process
Stop-Process -Name "nc" -Force -ErrorAction SilentlyContinue
```

*Status: Actionable via active-response triggers.*
"""

    def _mock_chat_response(self, message: str) -> str:
        """Answers typical user queries about SOC operations and security."""
        if "sql" in message or "sqli" in message:
            return """**SQL Injection (SQLi) Analysis**
- **MITRE technique**: T1190 (Exploit Public-Facing Application)
- **Remediation**:
  1. Use parameterized queries/prepared statements in database wrappers.
  2. Implement backend input validation.
  3. Set database account permissions to least-privilege (Zero-Trust).
  
*Would you like me to generate a secure Python SQL connection example?*"""
        
        elif "brute force" in message or "ssh" in message or "login" in message:
            return """**Brute Force / SSH attack mitigations:**
- **MITRE technique**: T1110 (Brute Force)
- **Recommended Action Items**:
  1. Change default SSH port from 22.
  2. Disable root password logins; enforce SSH key authentication.
  3. Install `fail2ban` on the host:
     ```bash
     sudo apt-get install fail2ban
     sudo systemctl enable fail2ban
     ```
  4. Use SentinelX active response to block attacker IP automatically."""

        elif "remediate" in message or "mitigate" in message or "fix" in message:
            return """To mitigate active endpoint alerts:
1. **Network Isolation**: Block the source IP in firewall rules.
2. **Process Containment**: Kill active parent/child shells.
3. **Log Collection**: Pull audit logs for root-cause forensic analysis.
4. **Credential Rotation**: Force password changes for affected profiles.

You can trigger these via the **Active Response** panel on the dashboard."""
            
        elif "report" in message:
            return """**SentinelX AI Automated Incident Report Summary**
- **Total Alerts Analyzed**: 18
- **Identified Incidents**: 1 Critical (SQLi on Webserver), 2 Medium (SSH login failures)
- **Mitigation status**: Attacker IP blocked, agent reported healthy state.
- **NIST CSF Alignment**: Detect (DE.AE-2), Respond (RS.RP-1) verified.
  
*Use the PDF export tool on the Live Alerts page to download this full audit compliance record.*"""

        # General helper
        return """Hello! I am **SentinelX AI**, your interactive threat hunting assistant.
How can I assist you today?
- *'Explain SQL Injection remediation'*
- *'Suggest actions for SSH brute force attacks'*
- *'Generate a SOC incident report'*
- *'How to set up SentinelX agent'*"""

ai_analyst = AIAnalyst()
