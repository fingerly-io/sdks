export interface paths {
    "/api/v1/attestation/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request an attestation challenge
         * @description Issues a one-time, five-minute challenge bound to the authenticated key. The Android SDK has the device keystore attest to it and includes the attestation in its identify request.
         */
        post: operations["requestAttestationChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List events
         * @description Identification events from the secret key's own organization and environment, newest first, in a window of at most 30 days that starts at most 30 days ago. There is no total count: a page with fewer rows than `page_size` is the last.
         */
        get: operations["listEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an event
         * @description One identification event by its request ID, from the secret key's own organization and environment. Read it on your server to verify what a client reported before you act on it. An event is normally readable within a few seconds of the identification.
         */
        get: operations["getEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{request_id}/supplement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a deferred report
         * @description Attaches the signals a browser collects after its initial budget to an identification that has already been answered. It never changes the visitor, the score, billing or webhooks. The JavaScript SDK sends it automatically. Resending the same report is answered as a duplicate.
         */
        post: operations["submitDeferredReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/identify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Identify a visitor
         * @description Submits the signal report a client SDK collected and answers with the complete verdict: the request ID, the visitor ID and its confidence, and the suspect score, level and triggers. There is no second call to make.
         *
         *     The client SDKs build and send this request. `signals` is produced by them and is not a public contract. Send an `Idempotency-Key` header, and the same value on every retry, so a retried identification is answered and charged once.
         */
        post: operations["identifyVisitor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Describe the management key
         * @description The organization, role and region of the key the request was made with. Every other management route names the organization in its path; read it here.
         */
        get: operations["describeManagementKey"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/proxy-credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List proxy keys */
        get: operations["listProxyKeys"];
        put?: never;
        /**
         * Issue a proxy key
         * @description The response carries `secret` in full, once.
         */
        post: operations["issueProxyKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/proxy-credentials/{proxy_credential_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke a proxy key */
        post: operations["revokeProxyKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/risk-weights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the organization's risk weights
         * @description One profile per platform, with the shipped defaults beside it. Every key without a profile of its own is scored under these.
         */
        get: operations["readOrganizationRiskWeights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/risk-weights/{platform}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Save the organization's risk weights for a platform
         * @description Every field is optional. Send the `revision` a read returned to be refused with 409 if someone saved in between. Applies to the next identification.
         */
        put: operations["saveOrganizationRiskWeightsPlatform"];
        post?: never;
        /** Restore the default risk weights for a platform */
        delete: operations["restoreDefaultRiskWeightsPlatform"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/sdk-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List SDK keys
         * @description Every public and secret key the organization holds, in every environment, revoked keys included. Secrets are never returned after issue.
         */
        get: operations["listSdkKeys"];
        put?: never;
        /**
         * Issue an SDK key
         * @description `kind` is public or secret, and `environment` is production, staging or development. A public key needs at least one allowed origin; a secret key may have none. The response carries `secret` in full, once.
         */
        post: operations["issueSdkKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/sdk-keys/{sdk_key_id}/origins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace a public key's allowed origins
         * @description Replaces the whole list. An origin is a scheme, a host and an optional port. An empty list refuses every browser request.
         */
        put: operations["replacePublicKeyAllowedOrigins"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/sdk-keys/{sdk_key_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke an SDK key
         * @description Refuses the key from the next request on. There is no un-revoke.
         */
        post: operations["revokeSdkKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/sdk-keys/{sdk_key_id}/risk-weights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an SDK key's risk weights
         * @description A platform the key has not overridden answers with the organization's values and `stored` false.
         */
        get: operations["readSdkKeyRiskWeights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/sdk-keys/{sdk_key_id}/risk-weights/{platform}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Save an SDK key's risk weights for a platform
         * @description Overrides the organization's profile for this key alone.
         */
        put: operations["saveSdkKeyRiskWeightsPlatform"];
        post?: never;
        /**
         * Remove an SDK key's risk weights for a platform
         * @description The key follows the organization's profile again.
         */
        delete: operations["removeSdkKeyRiskWeightsPlatform"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhook-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List webhook delivery attempts */
        get: operations["listWebhookDeliveryAttempts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List webhook endpoints */
        get: operations["listWebhookEndpoints"];
        put?: never;
        /**
         * Create a webhook endpoint
         * @description The response carries the signing secret in full, once.
         */
        post: operations["createWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhooks/{webhook_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a webhook endpoint */
        delete: operations["deleteWebhookEndpoint"];
        options?: never;
        head?: never;
        /**
         * Update a webhook endpoint
         * @description Send only the fields to change. `paused` pauses or resumes the endpoint.
         */
        patch: operations["updateWebhookEndpoint"];
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhooks/{webhook_id}/redeliver": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redeliver an event to a webhook endpoint */
        post: operations["redeliverEventWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhooks/{webhook_id}/rotate-secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate a webhook endpoint's signing secret
         * @description The new secret is returned once. The previous secret keeps signing deliveries for `previous_secret_valid_hours`, 24 by default and at most 168.
         */
        post: operations["rotateWebhookEndpointSigningSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/organizations/{organization_id}/webhooks/{webhook_id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a test event to a webhook endpoint */
        post: operations["sendTestEventWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/management/signals/catalogue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List signals
         * @description Every signal group and the signals in it, with the platforms each applies to. The vocabulary the weights routes are written in.
         */
        get: operations["listSignals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AttestationChallengeOut: {
            /** @description Base64-encoded one-use attestation nonce */
            challenge: string;
            /**
             * Format: date-time
             * @description When the nonce becomes unusable
             */
            expires_at: string;
        };
        CreatedWebhookOut: {
            endpoint: components["schemas"]["WebhookEndpointOut"];
            secret: string;
        };
        ErrorBody: {
            code: string;
            details?: components["schemas"]["ErrorDetail"][];
            message: string;
            /** Format: int64 */
            status: number;
        };
        ErrorDetail: {
            field: string;
            issue: string;
            location: string;
        };
        ErrorResponse: {
            error: components["schemas"]["ErrorBody"];
            request_id?: string;
        };
        EventRowOut: {
            agent?: string;
            agent_version?: string;
            anonymity_network?: string;
            asn?: string;
            asn_name?: string;
            country_code?: string;
            country_name?: string;
            device_kind?: string;
            environment: string;
            has_document: boolean;
            ip_address: string;
            occurred_at: string;
            origin?: string;
            os?: string;
            platform: string;
            request_id: string;
            sdk_platform: string;
            sdk_version: string;
            state: string;
            suspect_level?: string;
            /** Format: int32 */
            suspect_score?: number | null;
            tag?: string;
            triggers: components["schemas"]["EventTriggerOut"][];
            url_host?: string;
            url_path?: string;
            visitor_id: string;
            visitor_kind?: string;
        };
        EventTriggerOut: {
            confidence?: string;
            signal: string;
            /** Format: int32 */
            weight: number;
        };
        IdentifyIn: {
            /** @description Which SDK collected these signals */
            sdk: components["schemas"]["SDKInfo"];
            /** @description The platform-specific signals the SDK collected */
            signals: {
                [key: string]: unknown;
            };
            /** @description An opaque value echoed back on the event */
            tag?: string;
        };
        IdentifyOut: {
            /** @description Short-lived capability for the deferred signal report */
            deferred_token?: string;
            /** @description This submission was answered before; the verdict belongs to the first one */
            duplicate?: boolean;
            /** @description False when the report carried too little to identify anyone */
            identifiable: boolean;
            /** @description Why enrichment did not happen */
            reason?: string;
            /** @description Identifies this submission */
            request_id: string;
            /** @description Whether the address could be enriched */
            state: string;
            /** @description low, medium or high */
            suspect_level?: string;
            /**
             * Format: int32
             * @description The weighted sum of the signals that fired
             */
            suspect_score?: number | null;
            /** @description What fired, and what each was worth */
            triggers?: components["schemas"]["IdentifyTriggerOut"][];
            /**
             * Format: int32
             * @description How sure we are about visitor_id, 0 to 100
             */
            visitor_confidence: number;
            /** @description Who this visitor is, stable across their visits */
            visitor_id: string;
            /** @description Whether this is the first time this visitor has been seen */
            visitor_is_new: boolean;
        };
        IdentifyTriggerOut: {
            confidence?: string;
            group?: string;
            signal: string;
            /** Format: int64 */
            weight: number;
        };
        IssuedProxyCredentialOut: {
            credential: components["schemas"]["ProxyCredentialOut"];
            /** @description Returned once and never stored in plaintext */
            secret: string;
        };
        IssuedSDKKeyOut: {
            key: components["schemas"]["SDKKeyOut"];
            secret: string;
        };
        ManagementCallerOut: {
            key_id: string;
            name: string;
            /** @description The organization every management route acts on */
            organization_id: string;
            region: string;
            /** @description admin or developer */
            role: string;
        };
        ProxyCredentialOut: {
            /** Format: date-time */
            created_at: string;
            environment: string;
            /** Format: date-time */
            expires_at?: string | null;
            id: string;
            last4: string;
            /** Format: date-time */
            last_used_at?: string | null;
            name: string;
            prefix: string;
            region: string;
            /** Format: date-time */
            revoked_at?: string | null;
            status: string;
        };
        ProxyCredentialsOut: {
            credentials: components["schemas"]["ProxyCredentialOut"][];
        };
        RiskWeightsOut: {
            /** Format: int64 */
            max_weight: number;
            organization_id: string;
            platforms: components["schemas"]["RiskWeightsPlatformOut"][];
            /** @description organization or key */
            scope: string;
            sdk_key_id?: string;
        };
        RiskWeightsPlatformOut: {
            defaults: {
                [key: string]: number;
            };
            platform: string;
            /** @description method or confidence */
            residential_proxy_weights_mode: string;
            /** Format: int64 */
            revision?: number;
            /** @description key, organization or default */
            scope: string;
            signals: string[];
            /** @description Whether this scope has its own saved configuration */
            stored: boolean;
            /** Format: int64 */
            suspect_threshold: number;
            /** Format: date-time */
            updated_at?: string;
            updated_by_user_id?: string;
            /** @description method or confidence */
            vpn_weights_mode: string;
            weights: {
                [key: string]: number;
            };
        };
        SDKEventOut: {
            agent?: string;
            agent_version?: string;
            anonymity_network?: string;
            asn?: string;
            asn_name?: string;
            country_code?: string;
            country_name?: string;
            /** @description The deferred report attached to this request, when one arrived. Its contents are not a public contract. */
            deferred_signals?: Record<string, never>;
            device_kind?: string;
            /** @description The archived submission as Fingerly stored it, with the threshold and weights profile that scored it. Present when has_document is true. Its contents are not a public contract. */
            document?: Record<string, never> | null;
            environment: string;
            has_document: boolean;
            ip_address: string;
            occurred_at: string;
            origin?: string;
            os?: string;
            platform: string;
            request_id: string;
            sdk_platform: string;
            sdk_version: string;
            state: string;
            suspect_level?: string;
            /** Format: int32 */
            suspect_score?: number | null;
            tag?: string;
            triggers: components["schemas"]["EventTriggerOut"][];
            url_host?: string;
            url_path?: string;
            visitor_id: string;
            visitor_kind?: string;
        };
        SDKEventsOut: {
            /** Format: int64 */
            page: number;
            /** Format: int64 */
            page_size: number;
            rows: components["schemas"]["EventRowOut"][];
        };
        SDKInfo: {
            /** @description The SDK that collected these signals */
            platform: string;
            /** @description The SDK's version, such as 0.1.0 */
            version: string;
        };
        SDKKeyOut: {
            allowed_origins: string[];
            /** Format: date-time */
            created_at: string;
            created_by?: string;
            environment: string;
            /** Format: date-time */
            expires_at?: string | null;
            id: string;
            /** @description public or secret */
            kind: string;
            /** @description The tail of the secret, which is all a console ever shows */
            last4: string;
            /**
             * Format: date-time
             * @description Written best-effort and batched
             */
            last_used_at?: string | null;
            name: string;
            /** @description The human-readable stem, such as fly_pk_eu_production */
            prefix: string;
            /** @description Immutable data residency inherited from the organization */
            region: string;
            /** Format: date-time */
            revoked_at?: string | null;
            revoked_by?: string;
            /** @description active or revoked */
            status: string;
        };
        SDKKeysOut: {
            keys: components["schemas"]["SDKKeyOut"][];
        };
        SignalCatalogueOut: {
            /** Format: int64 */
            default_threshold: number;
            groups: components["schemas"]["SignalGroupOut"][];
            /** Format: int64 */
            max_weight: number;
            platforms: string[];
        };
        SignalGroupOut: {
            description: string;
            key: string;
            label: string;
            platforms: string[];
            signals: components["schemas"]["SignalMemberOut"][];
            weights: {
                [key: string]: number;
            };
        };
        SignalMemberOut: {
            signal: string;
            weights: {
                [key: string]: number;
            };
        };
        SupplementOut: {
            /** @description The identical supplement was accepted before */
            duplicate?: boolean;
            request_id: string;
        };
        WebhookDeliveriesOut: {
            deliveries: components["schemas"]["WebhookDeliveryOut"][];
            next_cursor?: string | null;
        };
        WebhookDeliveryOut: {
            /** Format: int64 */
            attempt: number;
            /** Format: int64 */
            duration_ms: number;
            endpoint_id: string;
            endpoint_url: string;
            environment: string;
            error?: string | null;
            event: string;
            event_id: string;
            id: string;
            /** Format: date-time */
            occurred_at: string;
            /** Format: int64 */
            response_code?: number | null;
            status: string;
        };
        WebhookEndpointOut: {
            /** Format: date-time */
            created_at: string;
            created_by?: string | null;
            /** Format: int64 */
            delivered_24h: number;
            description: string;
            environment: string;
            events: string[];
            /** Format: int64 */
            failed_24h: number;
            id: string;
            /** Format: date-time */
            last_delivery_at?: string | null;
            /** Format: date-time */
            previous_secret_expires_at?: string | null;
            secret_last4: string;
            status: string;
            url: string;
        };
        WebhookTestOut: {
            event_id: string;
        };
        WebhooksOut: {
            endpoints: components["schemas"]["WebhookEndpointOut"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    requestAttestationChallenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttestationChallengeOut"];
                };
            };
            /** @description No usable x-api-key header was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The organization this key belongs to is not accepting traffic */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description A challenge could not be issued just now */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listEvents: {
        parameters: {
            query?: {
                /** @description Start, inclusive (RFC 3339); defaults to 24 hours ago */
                from?: string;
                /** @description End, exclusive (RFC 3339); defaults to now */
                to?: string;
                /** @description One-based page */
                page?: number;
                /** @description Rows per page, capped at 200 */
                limit?: number;
                /** @description Exact visitor id */
                visitor?: string;
                /** @description low, medium or high */
                level?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SDKEventsOut"];
                };
            };
            /** @description No usable secret SDK key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SDKEventOut"];
                };
            };
            /** @description No usable secret SDK key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No event with that request ID in this key's environment, or it is older than 30 days */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    submitDeferredReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Which SDK collected these signals */
                    sdk: components["schemas"]["SDKInfo"];
                    /** @description A report containing only the deferred tier */
                    signals: {
                        [key: string]: unknown;
                    };
                    /** @description The deferred_token returned by identify */
                    token: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupplementOut"];
                };
            };
            /** @description No usable x-api-key header was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The organization this key belongs to is not accepting traffic */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description A different deferred report was already accepted for this request */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The report could not be accepted just now */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    identifyVisitor: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentifyIn"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentifyOut"];
                };
            };
            /** @description No usable x-api-key header was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The organization this key belongs to is not accepting traffic */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The body is over 1 MiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The organization is over its rate limit */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The identification could not be answered just now */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    describeManagementKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManagementCallerOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listProxyKeys: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProxyCredentialsOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may manage proxy keys */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    issueProxyKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description production, staging or development */
                    environment: string;
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssuedProxyCredentialOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may manage proxy keys */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    revokeProxyKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                proxy_credential_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProxyCredentialOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may manage proxy keys */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readOrganizationRiskWeights: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization whose weights these are */
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    saveOrganizationRiskWeightsPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization whose weights these are */
                organization_id: string;
                /** @description web, android or ios */
                platform: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description method or confidence */
                    residential_proxy_weights_mode?: string | null;
                    /**
                     * Format: int64
                     * @description The revision this edit was made against
                     */
                    revision?: number | null;
                    /**
                     * Format: int64
                     * @description The score at which a request is called suspicious
                     */
                    suspect_threshold?: number | null;
                    /** @description method or confidence */
                    vpn_weights_mode?: string | null;
                    /** @description Signal name to weight, 0-10000 */
                    weights?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsPlatformOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may change risk weights */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The weights changed since they were read */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description A weight, a mode or the threshold is not usable */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    restoreDefaultRiskWeightsPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization whose weights these are */
                organization_id: string;
                /** @description web, android or ios */
                platform: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsPlatformOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may change risk weights */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listSdkKeys: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization whose keys these are */
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SDKKeysOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The key's role cannot manage SDK keys */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    issueSdkKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization to issue into */
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    allowed_origins?: string[];
                    /** @description production, staging or development */
                    environment: string;
                    /** Format: date-time */
                    expires_at?: string | null;
                    /** @description public or secret */
                    kind: string;
                    /** @description What the key is called. The only part a person can recognise once the secret is masked */
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssuedSDKKeyOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The key could not be issued as described */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replacePublicKeyAllowedOrigins: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization the key belongs to */
                organization_id: string;
                /** @description The key to re-scope */
                sdk_key_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Scheme and host, no path. Empty refuses everything */
                    allowed_origins: string[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SDKKeyOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The key is revoked */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An origin is not valid, or the key is secret */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    revokeSdkKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization the key belongs to */
                organization_id: string;
                /** @description The key to act on */
                sdk_key_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SDKKeyOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The key is already revoked */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readSdkKeyRiskWeights: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization the key belongs to */
                organization_id: string;
                /** @description The key whose weights these are */
                sdk_key_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    saveSdkKeyRiskWeightsPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization the key belongs to */
                organization_id: string;
                /** @description The key whose weights these are */
                sdk_key_id: string;
                /** @description web, android or ios */
                platform: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description method or confidence */
                    residential_proxy_weights_mode?: string | null;
                    /**
                     * Format: int64
                     * @description The revision this edit was made against
                     */
                    revision?: number | null;
                    /**
                     * Format: int64
                     * @description The score at which a request is called suspicious
                     */
                    suspect_threshold?: number | null;
                    /** @description method or confidence */
                    vpn_weights_mode?: string | null;
                    /** @description Signal name to weight, 0-10000 */
                    weights?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsPlatformOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may change risk weights */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The weights changed since they were read */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description A weight, a mode or the threshold is not usable */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    removeSdkKeyRiskWeightsPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The organization the key belongs to */
                organization_id: string;
                /** @description The key whose override is being removed */
                sdk_key_id: string;
                /** @description web, android or ios */
                platform: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RiskWeightsPlatformOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Only an admin key may change risk weights */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listWebhookDeliveryAttempts: {
        parameters: {
            query?: {
                environment?: string;
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path: {
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDeliveriesOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listWebhookEndpoints: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhooksOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    description: string;
                    environment: string;
                    events: string[];
                    url: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedWebhookOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                webhook_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                webhook_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    description?: string | null;
                    environment?: string | null;
                    events?: string[] | null;
                    paused?: boolean | null;
                    url?: string | null;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEndpointOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    redeliverEventWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                webhook_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    event_id: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rotateWebhookEndpointSigningSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                webhook_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: int64 */
                    previous_secret_valid_hours?: number | null;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedWebhookOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    sendTestEventWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organization_id: string;
                webhook_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookTestOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request could not be validated. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listSignals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignalCatalogueOut"];
                };
            };
            /** @description No usable management key was presented */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The management key's role does not allow this */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No such resource in the key's organization */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An unexpected error occurred. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
