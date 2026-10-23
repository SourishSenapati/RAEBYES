# RAEBYES SOVEREIGN SOURCE-AVAILABLE COMMERCIAL & ENTERPRISE LICENSE (RSSAL-1.0)

**Version 1.0 — Effective October 2026**  
**Copyright (C) 2026 RAEBYES Governance Team & Sourish Senapati. All Rights Reserved.**  
**Contact:** `sourishsenapati791@gmail.com` | **Repository:** [https://github.com/SourishSenapati/RAEBYES](https://github.com/SourishSenapati/RAEBYES)

---

## 1. PREAMBLE & APPLICABILITY

This Commercial and Enterprise Software License Agreement ("Agreement") is a legally binding contract between the Licensor (Sourish Senapati / RAEBYES Governance Team) and the Licensee (whether an individual, corporation, enterprise, research laboratory, or government entity). 

This Agreement governs all commercial access, integration, embedding, modification, deployment, and execution of the RAEBYES software suite, including but not limited to:
- The `raebyesd` watchdog daemon and background process supervisor,
- The `raebyesctl` and `raebyes` unified CLI binaries,
- The `@raebyes/mcp` Model Context Protocol stdio interceptor and grammar sanitization proxy,
- The programmatic `@raebyes/sdk-js` and PyPI `raebyes` client libraries,
- All AST visitors, cryptographic receipt minters, worktree tournament evaluators, and configuration schemas.

Entities intending to use the Software outside the strict copyleft requirements of the GNU Affero General Public License v3 (AGPLv3) must acquire a valid commercial license under this Agreement.

---

## 2. DEFINITIONS

- **"Software"** means the RAEBYES code repository, compiled binaries, TypeScript/JavaScript modules, Python packages, AST diff rules, and related cryptographic governance assets.
- **"Licensee"** means the legal entity executing this Agreement upon purchasing a valid commercial license entitlement or activation key (`RAEBYES-PRO-XXXX` or `RAEBYES-ENT-XXXX`).
- **"Host System"** means any proprietary codebase, closed-source SaaS infrastructure, private cloud compute cluster, continuous integration/continuous deployment (CI/CD) pipeline, or local developer workstation operated by Licensee.
- **"Autonomous Execution Loop"** means any automated software process where an artificial intelligence model, reinforcement learning policy, autonomous agent framework, or evaluation benchmark issues filesystem modifications or terminal commands without prior human-in-the-loop line-by-line approval.
- **"Sovereign Enclave"** means an isolated, air-gapped, on-premise, or private VPC deployment with zero egress connections to public networks.

---

## 3. GRANT OF COMMERCIAL RIGHTS

Conditioned upon timely payment of commercial license fees and continuous adherence to Section 4 (Anti-Circumvention), Licensor grants Licensee a worldwide, non-exclusive, non-transferable license during the term of the license agreement to:

### 3.1 Closed-Source Embedding & Production Deployment
Licensee may embed, bundle, execute, and link the Software directly within proprietary, closed-source enterprise software stacks, commercial developer tools, IDE extensions, SaaS backends, and multi-tenant platforms without any obligation to disclose, publish, or license the source code of the host system or applications under AGPLv3 or any other copyleft license.

### 3.2 Frontier Laboratory & Evaluation Governance
Licensee may deploy the Software across high-performance compute clusters, GPU farms (e.g., NVIDIA H100/H200/B200 clusters), and training harnesses to supervise reinforcement learning with verifiable rewards (RLVR), automated code generation self-play, continuous pre-training, and benchmark evaluations.

### 3.3 Modification for Internal Workflows
Licensee may modify, tune, and extend the internal AST rules, regex patterns, IPC socket handlers, and tournament evaluators of the Software strictly for internal business operations, internal test frameworks, and integration with proprietary infrastructure.

### 3.4 Air-Gapped Sovereign Compute
Licensee has the explicit right to deploy the Software in fully disconnected, classified, or air-gapped sovereign environments without telemetry reporting, cloud pingbacks, or external license verification calls.

---

## 4. STRICT ANTI-CIRCUMVENTION & ANTI-TAMPER CONDITIONS

The commercial rights granted in Section 3 are strictly conditioned upon compliance with the following architectural invariants:

1. **Anti-Forgery of Cryptographic Receipts:** Licensee shall not reverse-engineer, forge, simulate, or spoof the HMAC-SHA256 execution proofs (`RUN-XXXX`) or tamper with `.raebyes/runs.lock` to simulate successful test or solver execution without actual process execution.
2. **Ledger Integrity Preservation:** Licensee shall not distribute or deploy modified versions of the Software designed to suppress, bypass, or corrupt the SHA-256 hash-chained antibody verification mechanisms (`.raebyes/antibodies.json`).
3. **No Standalone "RAEBYES-as-a-Service" Multi-Tenant Resale:** Licensee shall not repackage, rebrand, or offer the Software as a standalone commercial multi-tenant circuit breaker proxy or managed governance API service that directly competes with Licensor's hosted offerings without an explicit Master Services Agreement signed by Licensor.
4. **Preservation of Attribution:** All source files, compiled bundles, and documentation derived from the Software must preserve original copyright notices and maintainer attribution to Sourish Senapati and the RAEBYES Governance Team.

---

## 5. ENTERPRISE TIERS & ENTITLEMENTS

### 5.1 Team & Developer Seat Tier (`RAEBYES-PRO`)
- Authorized for internal developer workstations and CI/CD runners up to the purchased seat threshold.
- Full AGPLv3 copyleft immunity for host repositories.
- Multi-agent IDE integration (Antigravity, Cursor, Claude Code, Windsurf, local LLM harnesses).

### 5.2 Enterprise Laboratory & GPU Cluster Tier (`RAEBYES-ENT`)
- Unlimited seat deployment across all internal engineering teams.
- High-throughput cluster killswitch integration for Slurm, Kubernetes, and Ray distributed GPU workloads.
- Automated antibody cloud synchronization across distributed developer nodes.
- Direct architecture advisory channel and custom AST rule curation from the core maintainers.

---

## 6. WARRANTIES, DISCLAIMERS & LIMITATION OF LIABILITY

### 6.1 "AS IS" Provision
THE SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS", AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT ARE DISCLAIMED.

### 6.2 Compute & Token Runaway Limitation of Liability
IN NO EVENT SHALL THE LICENSOR, MAINTAINERS, OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; RECURSIVE TOKEN RUNAWAY COSTS; UNINTENDED GPU COMPUTE CONSUMPTION; LOSS OF TRAINING RUN CONTINUITY; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## 7. TERMINATION & SURVIVAL

This Agreement remains effective until terminated. Licensee may terminate it at any time by ceasing all use and destroying all copies of the Software. Licensor may terminate this Agreement immediately upon written notice if Licensee breaches any material provision of this Agreement (including Section 4). Upon termination, all commercial rights granted under Section 3 terminate immediately. Sections 2, 4, 6, 7, and 8 shall survive termination.

---

## 8. GOVERNING LAW & JURISDICTION

This Agreement shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law principles. Any legal suit, action, or proceeding arising out of or related to this Agreement shall be instituted exclusively in the competent courts having jurisdiction over the maintainer's primary domicile.

---

## 9. COMMERCIAL INQUIRIES & LICENSE ACTIVATION

To execute an Enterprise Agreement, obtain commercial license keys, request custom procurement terms, or confirm air-gapped entitlement:

- **Commercial Licensing Contact:** `sourishsenapati791@gmail.com`
- **Lead Maintainer & Systems Architect:** Sourish Senapati (`sourishsenapati791@gmail.com`)
- **Official Repository:** [https://github.com/SourishSenapati/RAEBYES](https://github.com/SourishSenapati/RAEBYES)
