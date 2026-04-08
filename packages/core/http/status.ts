import { STATUS_TEXT as DENO_STATUS_TEXT } from "@std/http";

export enum StatusCode {
  /**
   * The server has received the request headers and the client should proceed
   * to send the request body (in the case of a request for which a body needs
   * to be sent, such as a POST request).
   */
  Continue = 100,
  /**
   * The requester has asked the server to switch protocols and the server has
   * agreed to do so.
   */
  SwitchingProtocols = 101,
  /**
   * A WebDAV request may contain many sub-requests involving file operations,
   * requiring a long time to complete the request. This code indicates that
   * the server has received and is processing the request, but no response
   * is available yet. This prevents the client from timing out and assuming
   * the request was lost.
   *
   * @deprecated The status code is deprecated.
   */
  Processing = 102,
  /**
   * Used to return some response headers before final HTTP message.
   */
  EarlyHints = 103,

  /**
   * Standard response for successful HTTP requests. The actual response will
   * depend on the request method used.
   * In a GET request, the response will contain an entity corresponding to the
   * requested resource. In a POST request, the response will contain an entity
   * describing or containing the result of the action.
   */
  Ok = 200,
  /**
   * The request has been fulfilled, resulting in the creation of a new resource.
   */
  Created = 201,
  /**
   * The request has been accepted for processing, but the processing has not
   * been completed. The request might or might not be eventually acted upon,
   * and may be disallowed when processing occurs.
   */
  Accepted = 202,
  /**
   * The server is a transforming proxy (e.g. a Web accelerator) that received
   * a 200 OK from its origin, but is returning a modified version of the
   * origin's response.
   */
  NonAuthoritativeInfo = 203,
  /**
   * The server successfully processed the request, and is not returning any content.
   */
  NoContent = 204,
  /**
   * The server successfully processed the request, asks that the requester reset
   * its document view, and is not returning any content.
   */
  ResetContent = 205,
  /**
   * The server is delivering only part of the resource (byte serving) due to a
   * range header sent by the client. The range header is used by HTTP clients to
   * enable resuming of interrupted downloads, or split a download into multiple
   * simultaneous streams.
   */
  PartialContent = 206,
  /**
   * The message body that follows is by default an XML message and can contain
   * a number of separate response codes, depending on how many sub-requests were made.
   */
  MultiStatus = 207,
  /**
   * The members of a DAV binding have already been enumerated in a preceding part
   * of the (multistatus) response, and are not being included again.
   */
  AlreadyReported = 208,
  /**
   * The server has fulfilled a request for the resource, and the response is a
   * representation of the result of one or more instance-manipulations applied
   * to the current instance.
   */
  IMUsed = 226,

  /**
   * Indicates multiple options for the resource from which the client may choose
   * (via agent-driven content negotiation). For example, this code could be used
   * to present multiple video format options, to list files with different
   * filename extensions, or to suggest word-sense disambiguation.
   */
  MultipleChoices = 300,
  /**
   * The link target was moved such that the request and future similar requests
   * should be redirected to the given URI. If a client has link-editing capabilities,
   * it should update references to the request URL. The response is cacheable unless
   * indicated otherwise. Except for a GET request, the body should contain a hyperlink
   * to the new URL(s). Except for a GET or HEAD request, the client must ask the user
   * before redirecting.
   *
   * This code is considered best practice for upgrading users from HTTP to HTTPS. Both
   * Bing and Google recommend using this code to change the URL of a page as it is
   * shown in search engine results, providing that URL will permanently change and
   * is not due to be changed again any time soon.
   */
  MovedPermanently = 301,
  /**
   * Indicates that the resource is accessible via an alternate URL indicated in the
   * Location header field. The HTTP/1.0 specification (which used reason phrase
   * "Moved Temporarily") required the client to redirect with the same method, but
   * popular browsers instead changed the request to GET.
   */
  Found = 302,
  /**
   * If a server responds to a POST or other non-idempotent request with this code and
   * a location header field, the client is expected to issue a GET request to the
   * specified location. To trigger a request to the target resource using the same method,
   * the server responds with 307 instead.
   */
  SeeOther = 303,
  /**
   * Indicates that the resource has not been modified since the version specified by the
   * request headers If-Modified-Since or If-None-Match. In such case, there is no need to
   * retransmit the resource since the client still has a previously-downloaded copy.
   */
  NotModified = 304,
  /**
   * The requested resource is available only through a proxy, the address for which is
   * provided in the response. For security reasons, many HTTP clients (such as
   * Mozilla Firefox and Internet Explorer) do not obey this status code.
   */
  UseProxy = 305,
  /**
   * No longer used. Originally meant "Subsequent requests should use the specified proxy."
   */
  SwitchProxy = 306,
  /**
   * In this case, the request should be repeated with another URI; however, future requests
   * should still use the original URI. In contrast to how 302 was historically implemented,
   * the request method is not allowed to be changed when reissuing the original request.
   * For example, a POST request should be repeated using another POST request.
   */
  TemporaryRedirect = 307,
  /**
   * This and all future requests should be directed to the given URI. 308 parallels the
   * behavior of 301, but does not allow the HTTP method to change. So, for example,
   * submitting a form to a permanently redirected resource may continue smoothly.
   */
  PermanentRedirect = 308,

  /**
   * The server cannot or will not process the request due to an apparent client error
   * (e.g., malformed request syntax, size too large, invalid request message framing,
   * or deceptive request routing).
   */
  BadRequest = 400,
  /**
   * Similar to 403 Forbidden, but specifically for use when authentication is
   * required and has failed or has not yet been provided. The response must include
   * a WWW-Authenticate header field containing a challenge applicable to the
   * requested  resource. See Basic access authentication and Digest access
   * authentication. 401 semantically means "unauthenticated", the user does not
   * have valid authentication credentials for the target resource.
   */
  Unauthorized = 401,
  /**
   * Reserved for future use. The original intention was that this code might be used as part
   * of some form of digital cash or micropayment scheme, as proposed, for example, by GNU Taler,
   * but that has not yet happened, and this code is not widely used. Google Developers API uses
   * this status if a particular developer has exceeded the daily limit on requests.
   * Sipgate uses this code if an account does not have sufficient funds to start a call.
   * Shopify uses this code when the store has not paid their fees and is temporarily disabled.
   * Stripe uses this code for failed payments where parameters were correct, for example blocked
   * fraudulent payments.
   */
  PaymentRequired = 402,
  /**
   * The request was valid, but the server refuses action. This may be due to the user not having
   * permission to a resource or needing an account of some sort, or attempting a prohibited action
   * (e.g. creating a duplicate record where only one is allowed). This code is also typically used
   * if the request provided authentication by answering the WWW-Authenticate header field challenge,
   * but the server did not accept that authentication. The request should not be repeated.
   *
   * This code differs from 401 in that while 401 is returned when the client has not authenticated,
   * and implies that a successful response may be returned following valid authentication, 403 is
   * returned when the client is not permitted access to the resource despite providing authentication
   * such as insufficient permissions of the authenticated account.
   *
   * The Apache web server returns 403 in response to a request for URL paths that corresponded to a
   * file system directory when directory listing is disabled and there is no Directory Index directive
   * to specify an existing file to be returned to the browser. Some administrators configure the Mod
   * proxy extension to block such requests and this will also return 403. IIS responds in the same
   * way when directory listings are denied in that server. In WebDAV, 403 is returned if the client
   * issued a PROPFIND request but did not also issue the required Depth header or issued a Depth
   * header of infinity.
   *
   * The code can occur for the following reasons:
   * - Insufficient permission: The most common reason is that the user lacks the necessary permission to access a resource.
   * - Authentication required: In some cases, the server requires authentication to access certain resources.
   * - IP restrictions: The server may also restrict access to specific IP addresses or IP ranges.
   * - Server configuration: The server's configuration can be set to prohibit access to certain files, directories, or areas of the website. This can be due to a misconfiguration or intentional restrictions imposed by the server administrator.
   * - Blocked by firewall or security software: This code can result if a firewall or security software blocks access to the resource. This may happen due to security policies, malware detection, or other security measures.
   * - Rate limiting or too many requests: When a client sends excessive requests within a short timeframe, a server may reply with 403 to prevent abuse or denial-of-service attacks.
   */
  Forbidden = 403,
  /**
   * The requested resource could not be found but may be available in the future.
   * Subsequent requests by the client are permissible.
   */
  NotFound = 404,
  /**
   * A request method is not supported for the requested resource (for example, a
   * GET request on a form that requires data to be presented via POST, or a PUT
   * request on a read-only resource).
   */
  MethodNotAllowed = 405,
  /**
   * The requested resource is capable of generating only content not acceptable
   * according to the Accept headers sent in the request. See Content negotiation.
   */
  NotAcceptable = 406,
  /**
   * The client must first authenticate itself with the proxy.
   */
  ProxyAuthenticationRequired = 407,
  /**
   * The server timed out waiting for the request. According to HTTP specifications:
   * "The client did not produce a request within the time that the server was
   * prepared to wait. The client MAY repeat the request without modifications
   * at any later time."
   */
  RequestTimeout = 408,
  /**
   * Indicates that the request could not be processed because of conflict in the
   * current state of the resource, such as an edit conflict between multiple
   * simultaneous updates.
   */
  Conflict = 409,
  /**
   * Indicates that the resource requested was previously in use but is no longer
   * available and will not be available again. This should be used when a resource
   * has been intentionally removed and the resource should be purged.
   * Upon receiving a 410 status code, the client should not request the resource
   * in the future. Clients such as search engines should remove the resource from
   * their indices. Most use cases do not require clients and search engines to
   * purge the resource, and a "404 Not Found" may be used instead.
   */
  Gone = 410,
  /**
   * The request did not specify the length of its content, which is required by
   * the requested resource.
   */
  LengthRequired = 411,
  /**
   * The server does not meet one of the preconditions that the requester put on
   * the request header fields.
   */
  PreconditionFailed = 412,
  /**
   * The request is larger than the server is willing or able to process.
   * Previously called "Request Entity Too Large" and "Payload Too Large".
   */
  ContentTooLarge = 413,
  /**
   * The URI provided was too long for the server to process. Often the result
   * of too much data being encoded as a query-string of a GET request, in which
   * case it should be converted to a POST request.
   *
   * Called "Request-URI Too Long" previously.
   */
  UriTooLong = 414,
  /**
   * The request entity has a media type which the server or resource does not
   * support. For example, the client uploads an image as image/svg+xml,
   * but the server requires that images use a different format.
   */
  UnsupportedMediaType = 415,
  /**
   * The client has asked for a portion of the file (byte serving), but the server
   * cannot supply that portion. For example, if the client asked for a part of
   * the file that lies beyond the end of the file.
   *
   * Called "Requested Range Not Satisfiable" previously.
   */
  RangeNotSatisfiable = 416,
  /**
   * The server cannot meet the requirements of the Expect request-header field.
   */
  ExpectationFailed = 417,
  /**
   * This code was defined in 1998 as one of the traditional IETF April Fools' jokes,
   * in RFC 2324, Hyper Text Coffee Pot Control Protocol, and is not expected to be
   * implemented by actual HTTP servers. The RFC specifies this code should be returned
   * by teapots requested to brew coffee. This HTTP status is used as an Easter egg in
   * some websites, such as Google.com's "I'm a teapot" easter egg. Sometimes, this
   * status code is also used as a response to a blocked request, instead of the more
   * appropriate 403 Forbidden.
   */
  Teapot = 418,
  /**
   * The request was directed at a server that is not able to produce a response
   * (for example because of connection reuse).
   */
  MisdirectedRequest = 421,
  /**
   * The request was well-formed (i.e., syntactically correct) but could not be processed.
   */
  UnprocessableContent = 422,
  /**
   * The resource that is being accessed is locked.
   */
  Locked = 423,
  /**
   * The request failed because it depended on another request and that request failed
   * (e.g., a PROPPATCH).
   */
  FailedDependency = 424,
  /**
   * Indicates that the server is unwilling to risk processing a request that might
   * be replayed.
   */
  TooEarly = 425,
  /**
   * The client should switch to a different protocol such as TLS/1.3,
   * given in the Upgrade header field.
   */
  UpgradeRequired = 426,
  /**
   * The origin server requires the request to be conditional. Intended to prevent the
   * 'lost update' problem, where a client GETs a resource's state, modifies it,
   * and PUTs it back to the server, when meanwhile a third party has modified the
   * state on the server, leading to a conflict.
   */
  PreconditionRequired = 428,
  /**
   * The user has sent too many requests in a given amount of time.
   * Intended for use with rate-limiting schemes.
   */
  TooManyRequests = 429,
  /**
   * The server is unwilling to process the request because either an individual header
   * field, or all the header fields collectively, are too large.
   */
  RequestHeaderFieldsTooLarge = 431,
  /**
   * A server operator has received a legal demand to deny access to a resource or to a
   * set of resources that includes the requested resource. The code 451 was chosen as
   * a reference to the novel Fahrenheit 451.
   */
  UnavailableForLegalReasons = 451,

  /**
   * A generic error message, given when an unexpected condition was encountered and
   * no more specific message is suitable.
   */
  InternalServerError = 500,
  /**
   * The server either does not recognize the request method, or it lacks the ability
   * to fulfil the request. Usually this implies future availability
   * (e.g., a new feature of a web-service API).
   */
  NotImplemented = 501,
  /**
   * The server was acting as a gateway or proxy and received an invalid response
   * from the upstream server.
   */
  BadGateway = 502,
  /**
   * The server cannot handle the request (because it is overloaded or down for
   * maintenance). Generally, this is a temporary state.
   */
  ServiceUnavailable = 503,
  /**
   * The server was acting as a gateway or proxy and did not receive a timely
   * response from the upstream server.
   */
  GatewayTimeout = 504,
  /**
   * The server does not support the HTTP version used in the request.
   */
  HttpVersionNotSupported = 505,
  /**
   * Transparent content negotiation for the request results in a circular reference.
   */
  VariantAlsoNegotiates = 506,
  /**
   * The server is unable to store the representation needed to complete the request.
   */
  InsufficientStorage = 507,
  /**
   * The server detected an infinite loop while processing the request
   * (sent instead of 208 Already Reported).
   */
  LoopDetected = 508,
  /**
   * Further extensions to the request are required for the server to fulfil it.
   */
  NotExtended = 510,
  /**
   * The client needs to authenticate to gain network access. Intended for use by
   * intercepting proxies used to control access to the network (e.g., "captive portals"
   * used to require agreement to Terms of Service before granting full Internet access
   * via a Wi-Fi hotspot).
   */
  NetworkAuthenticationRequired = 511,

  /**
   * Used internally to instruct the server to return no information to the client and
   * close the connection immediately.
   */
  NginxNoResponse = 444,
  /**
   * Client sent too large request or too long header line.
   */
  NginxRequestHeaderTooLarge = 494,
  /**
   * An expansion of the 400 Bad Request response code, used when the client has provided
   * an invalid client certificate.
   */
  NginxSslCertificateError = 495,
  /**
   * An expansion of the 400 Bad Request response code, used when a client certificate is
   * required but not provided.
   */
  NginxSslCertificateRequried = 496,
  /**
   * An expansion of the 400 Bad Request response code, used when the client has made a
   * HTTP request to a port listening for HTTPS requests.
   */
  NginxHttpRequestSentToHttpsPort = 497,
  /**
   * Used when the client has closed the request before the server could send a response.
   */
  NginxClientClosedRequest = 499,

  /**
   * The origin server returned an empty, unknown, or unexpected response to Cloudflare.
   */
  CfWebServerReturnedAnUnknownError = 520,
  /**
   * The origin server refused connections from Cloudflare. Security solutions at the
   * origin may be blocking legitimate connections from certain Cloudflare IP addresses.
   */
  CfWebServerIsDown = 521,
  /**
   * Cloudflare timed out contacting the origin server.
   */
  CfConnectionTimedOut = 522,
  /**
   * Cloudflare could not contact the origin server.
   */
  CfOriginIsUnreachable = 523,
  /**
   * Cloudflare was able to complete a TCP connection to the origin server, but the
   * origin did not provide a timely HTTP response.
   */
  CfTimeoutOccurred = 524,
  /**
   * Cloudflare could not negotiate a SSL/TLS handshake with the origin server.
   */
  CfSslHandshakeFailed = 525,
  /**
   * Cloudflare could not validate the SSL certificate on the origin web server.
   * Also used by Cloud Foundry's gorouter.
   */
  CfInvalidSslCertificate = 526,
  /**
   * Cloudflare was unable to resolve the origin hostname, preventing it from
   * establishing a connection to the origin server.
   * The body of the response contains an 1xxx error.
   */
  CfOriginUnavailable = 530,

  /**
   * An informal convention used by some HTTP proxies to signal a network read
   * timeout behind the proxy to a client in front of the proxy.
   */
  NetworkReadTimeoutError = 598,
  /**
   * An error used by some HTTP proxies to signal a network connect timeout
   * behind the proxy to a client in front of the proxy.
   */
  NetworkConnectTimeoutError = 599,
}

export const STATUS_TEXT = {
  [StatusCode.Continue]: DENO_STATUS_TEXT[StatusCode.Continue],
  [StatusCode.SwitchingProtocols]:
    DENO_STATUS_TEXT[StatusCode.SwitchingProtocols],
  [StatusCode.Processing]: DENO_STATUS_TEXT[StatusCode.Processing],
  [StatusCode.EarlyHints]: DENO_STATUS_TEXT[StatusCode.EarlyHints],
  [StatusCode.Ok]: DENO_STATUS_TEXT[StatusCode.Ok],
  [StatusCode.Created]: DENO_STATUS_TEXT[StatusCode.Created],
  [StatusCode.Accepted]: DENO_STATUS_TEXT[StatusCode.Accepted],
  [StatusCode.NonAuthoritativeInfo]:
    DENO_STATUS_TEXT[StatusCode.NonAuthoritativeInfo],
  [StatusCode.NoContent]: DENO_STATUS_TEXT[StatusCode.NoContent],
  [StatusCode.ResetContent]: DENO_STATUS_TEXT[StatusCode.ResetContent],
  [StatusCode.PartialContent]: DENO_STATUS_TEXT[StatusCode.PartialContent],
  [StatusCode.MultiStatus]: DENO_STATUS_TEXT[StatusCode.MultiStatus],
  [StatusCode.AlreadyReported]: DENO_STATUS_TEXT[StatusCode.AlreadyReported],
  [StatusCode.IMUsed]: DENO_STATUS_TEXT[StatusCode.IMUsed],
  [StatusCode.MultipleChoices]: DENO_STATUS_TEXT[StatusCode.MultipleChoices],
  [StatusCode.MovedPermanently]: DENO_STATUS_TEXT[StatusCode.MovedPermanently],
  [StatusCode.Found]: DENO_STATUS_TEXT[StatusCode.Found],
  [StatusCode.NotModified]: DENO_STATUS_TEXT[StatusCode.NotModified],
  [StatusCode.UseProxy]: DENO_STATUS_TEXT[StatusCode.UseProxy],
  [StatusCode.SwitchProxy]: "Switch Proxy",
  [StatusCode.TemporaryRedirect]:
    DENO_STATUS_TEXT[StatusCode.TemporaryRedirect],
  [StatusCode.PermanentRedirect]:
    DENO_STATUS_TEXT[StatusCode.PermanentRedirect],
  [StatusCode.BadRequest]: DENO_STATUS_TEXT[StatusCode.BadRequest],
  [StatusCode.Unauthorized]: DENO_STATUS_TEXT[StatusCode.Unauthorized],
  [StatusCode.PaymentRequired]: DENO_STATUS_TEXT[StatusCode.PaymentRequired],
  [StatusCode.Forbidden]: DENO_STATUS_TEXT[StatusCode.Forbidden],
  [StatusCode.NotFound]: DENO_STATUS_TEXT[StatusCode.NotFound],
  [StatusCode.MethodNotAllowed]: DENO_STATUS_TEXT[StatusCode.MethodNotAllowed],
  [StatusCode.NotAcceptable]: DENO_STATUS_TEXT[StatusCode.NotAcceptable],
  [StatusCode.ProxyAuthenticationRequired]:
    DENO_STATUS_TEXT[StatusCode.ProxyAuthenticationRequired],
  [StatusCode.RequestTimeout]: DENO_STATUS_TEXT[StatusCode.RequestTimeout],
  [StatusCode.Conflict]: DENO_STATUS_TEXT[StatusCode.Conflict],
  [StatusCode.Gone]: DENO_STATUS_TEXT[StatusCode.Gone],
  [StatusCode.LengthRequired]: DENO_STATUS_TEXT[StatusCode.LengthRequired],
  [StatusCode.PreconditionFailed]:
    DENO_STATUS_TEXT[StatusCode.PreconditionFailed],
  [StatusCode.ContentTooLarge]: DENO_STATUS_TEXT[StatusCode.ContentTooLarge],
  [StatusCode.UriTooLong]: DENO_STATUS_TEXT[StatusCode.UriTooLong],
  [StatusCode.UnsupportedMediaType]:
    DENO_STATUS_TEXT[StatusCode.UnsupportedMediaType],
  [StatusCode.RangeNotSatisfiable]:
    DENO_STATUS_TEXT[StatusCode.RangeNotSatisfiable],
  [StatusCode.ExpectationFailed]:
    DENO_STATUS_TEXT[StatusCode.ExpectationFailed],
  [StatusCode.Teapot]: DENO_STATUS_TEXT[StatusCode.Teapot],
  [StatusCode.MisdirectedRequest]:
    DENO_STATUS_TEXT[StatusCode.MisdirectedRequest],
  [StatusCode.UnprocessableContent]:
    DENO_STATUS_TEXT[StatusCode.UnprocessableContent],
  [StatusCode.Locked]: DENO_STATUS_TEXT[StatusCode.Locked],
  [StatusCode.FailedDependency]: DENO_STATUS_TEXT[StatusCode.FailedDependency],
  [StatusCode.TooEarly]: DENO_STATUS_TEXT[StatusCode.TooEarly],
  [StatusCode.UpgradeRequired]: DENO_STATUS_TEXT[StatusCode.UpgradeRequired],
  [StatusCode.PreconditionRequired]:
    DENO_STATUS_TEXT[StatusCode.PreconditionRequired],
  [StatusCode.TooManyRequests]: DENO_STATUS_TEXT[StatusCode.TooManyRequests],
  [StatusCode.RequestHeaderFieldsTooLarge]:
    DENO_STATUS_TEXT[StatusCode.RequestHeaderFieldsTooLarge],
  [StatusCode.UnavailableForLegalReasons]:
    DENO_STATUS_TEXT[StatusCode.UnavailableForLegalReasons],
  [StatusCode.InternalServerError]:
    DENO_STATUS_TEXT[StatusCode.InternalServerError],
  [StatusCode.NotImplemented]: DENO_STATUS_TEXT[StatusCode.NotImplemented],
  [StatusCode.BadGateway]: DENO_STATUS_TEXT[StatusCode.BadGateway],
  [StatusCode.ServiceUnavailable]:
    DENO_STATUS_TEXT[StatusCode.ServiceUnavailable],
  [StatusCode.GatewayTimeout]: DENO_STATUS_TEXT[StatusCode.GatewayTimeout],
  [StatusCode.HttpVersionNotSupported]:
    DENO_STATUS_TEXT[StatusCode.HttpVersionNotSupported],
  [StatusCode.VariantAlsoNegotiates]:
    DENO_STATUS_TEXT[StatusCode.VariantAlsoNegotiates],
  [StatusCode.InsufficientStorage]:
    DENO_STATUS_TEXT[StatusCode.InsufficientStorage],
  [StatusCode.LoopDetected]: DENO_STATUS_TEXT[StatusCode.LoopDetected],
  [StatusCode.NotExtended]: DENO_STATUS_TEXT[StatusCode.NotExtended],
  [StatusCode.NetworkAuthenticationRequired]:
    DENO_STATUS_TEXT[StatusCode.NetworkAuthenticationRequired],
  [StatusCode.NginxNoResponse]: "No Response",
  [StatusCode.NginxRequestHeaderTooLarge]: "Request header too large",
  [StatusCode.NginxSslCertificateError]: "SSL Certificate Error",
  [StatusCode.NginxSslCertificateRequried]: "SSL Certficate Required",
  [StatusCode.NginxHttpRequestSentToHttpsPort]:
    "HTTP Request Sent to HTTPS Port",
  [StatusCode.NginxClientClosedRequest]: "Client Closed Request",
  [StatusCode.CfWebServerReturnedAnUnknownError]:
    "Cloudflare: Web Server Returned an Unknown Error",
  [StatusCode.CfWebServerIsDown]: "Cloudflare: Web Server Is Down",
  [StatusCode.CfConnectionTimedOut]: "Cloudflare: Connection Timed Out",
  [StatusCode.CfOriginIsUnreachable]: "Cloudflare: Origin Is Unreachable",
  [StatusCode.CfTimeoutOccurred]: "Cloudflare: A Timeout Occured",
  [StatusCode.CfSslHandshakeFailed]: "Cloudflare: SSL Handshake Failed",
  [StatusCode.CfInvalidSslCertificate]: "Cloudflare: Invalid SSL Certificate",
  [StatusCode.CfOriginUnavailable]: "Cloudflare: Origin Unavailable",
  [StatusCode.NetworkReadTimeoutError]: "Cloudflare: Read Timeout Error",
  [StatusCode.NetworkConnectTimeoutError]: "Cloudflare: Origin Unavailable",
} as const;

/**
 * A union of all HTTP status codes that represent error responses (4xx and 5xx).
 *
 * Includes standard client error codes (4xx) such as {@linkcode StatusCode.BadRequest},
 * {@linkcode StatusCode.Unauthorized}, and {@linkcode StatusCode.NotFound}, as well as
 * server error codes (5xx) such as {@linkcode StatusCode.InternalServerError} and
 * {@linkcode StatusCode.ServiceUnavailable}.
 *
 * Useful for narrowing response types or constraining exception constructors to
 * only accept valid error status codes.
 */
export type ErrorHttpStatusCode =
  | StatusCode.BadGateway
  | StatusCode.BadRequest
  | StatusCode.Conflict
  | StatusCode.Forbidden
  | StatusCode.GatewayTimeout
  | StatusCode.Gone
  | StatusCode.InsufficientStorage
  | StatusCode.InternalServerError
  | StatusCode.Locked
  | StatusCode.MethodNotAllowed
  | StatusCode.NotAcceptable
  | StatusCode.NotFound
  | StatusCode.NotImplemented
  | StatusCode.ContentTooLarge
  | StatusCode.PaymentRequired
  | StatusCode.PreconditionFailed
  | StatusCode.RequestTimeout
  | StatusCode.ServiceUnavailable
  | StatusCode.Teapot
  | StatusCode.TooEarly
  | StatusCode.Unauthorized
  | StatusCode.UnavailableForLegalReasons
  | StatusCode.UnprocessableContent
  | StatusCode.UnsupportedMediaType;
