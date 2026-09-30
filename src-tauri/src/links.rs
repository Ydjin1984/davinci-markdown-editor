//! Validation for links handed to the operating system.
//!
//! A Markdown file is untrusted input, and a link in one becomes a request the
//! user's browser makes on the user's behalf. Only `http`, `https` and `mailto`
//! are opened, and an `http(s)` target must not point at the local machine or a
//! private network: otherwise a document could drive requests at a router's
//! admin page, a service listening on loopback, or a cloud metadata endpoint
//! that is reachable from the host but not from the internet.
//!
//! Host names are checked as literals. A name that resolves to a private address
//! (`intranet.example`, `router.local`) cannot be detected without performing a
//! DNS lookup, which this application deliberately does not do — it hands the
//! URL to the shell and never issues a request itself.

use crate::error::{AppError, ErrorCode, Result};
use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

/// Schemes the shell may be asked to open.
const ALLOWED_SCHEMES: &[&str] = &["http", "https", "mailto"];

fn blocked(host: &Host<&str>) -> AppError {
    AppError::new(
        ErrorCode::Unsupported,
        "Links to the local machine or a private network are not opened.",
    )
    .with_detail(format!("host '{host}'"))
}

/// Parse and vet a URL before it is passed to the operating system.
pub fn check(raw: &str) -> Result<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidPath, "The link is empty."));
    }

    let url = Url::parse(trimmed).map_err(|error| {
        AppError::new(ErrorCode::Unsupported, "That is not a valid link.")
            .with_detail(error.to_string())
    })?;

    let scheme = url.scheme().to_ascii_lowercase();
    if !ALLOWED_SCHEMES.contains(&scheme.as_str()) {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "That kind of link is not opened automatically.",
        )
        .with_detail(format!("scheme '{scheme}'")));
    }

    // `mailto` carries no host, so there is nothing further to check. The URL
    // parser has already folded IPv4-mapped IPv6 forms into plain IPv4.
    if let Some(host) = url.host() {
        let reachable = match &host {
            Host::Domain(name) => domain_is_public(name),
            Host::Ipv4(address) => is_public_v4(*address),
            Host::Ipv6(address) => is_public_v6(*address),
        };
        if !reachable {
            return Err(blocked(&host));
        }
    }

    Ok(url)
}

/// Whether a host name is one a document may point the browser at.
///
/// Names that resolve to a private address cannot be told apart from public
/// ones without a DNS lookup, which this application never performs; see the
/// module note.
fn domain_is_public(name: &str) -> bool {
    // A trailing dot is a legal fully-qualified form (`example.com.`).
    let normalised = name.trim_end_matches('.').to_ascii_lowercase();
    if normalised.is_empty() {
        return false;
    }
    normalised != "localhost" && !normalised.ends_with(".localhost")
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let octets = address.octets();

    if address.is_loopback()          // 127.0.0.0/8
        || address.is_private()       // 10/8, 172.16/12, 192.168/16
        || address.is_link_local()    // 169.254.0.0/16, including cloud metadata
        || address.is_unspecified()   // 0.0.0.0
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_multicast()
    {
        return false;
    }

    // Ranges the standard library does not name.
    if octets[0] == 0 {
        return false; // 0.0.0.0/8 "this network"
    }
    if octets[0] == 100 && (octets[1] & 0xc0) == 64 {
        return false; // 100.64.0.0/10 carrier-grade NAT
    }
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 {
        return false; // 192.0.0.0/24 IETF protocol assignments
    }
    if octets[0] == 198 && (octets[1] & 0xfe) == 18 {
        return false; // 198.18.0.0/15 benchmarking
    }
    if octets[0] >= 240 {
        return false; // 240.0.0.0/4 reserved
    }

    true
}

fn is_public_v6(address: Ipv6Addr) -> bool {
    if address.is_loopback() || address.is_unspecified() || address.is_multicast() {
        return false;
    }

    // An IPv4-mapped address must be judged by the address it carries, or
    // `::ffff:127.0.0.1` would pass as public.
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_public_v4(mapped);
    }

    let segments = address.segments();
    if segments[0] & 0xfe00 == 0xfc00 {
        return false; // fc00::/7 unique local
    }
    if segments[0] & 0xffc0 == 0xfe80 {
        return false; // fe80::/10 link local
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_web_links() {
        for url in [
            "https://example.com",
            "https://www.davinci-cyber-engineering.uz/",
            "http://example.com/docs?q=1#top",
            "https://sub.domain.example.co.uk/path",
            "https://8.8.8.8/",
            "https://[2606:4700::1111]/",
        ] {
            assert!(check(url).is_ok(), "should be allowed: {url}");
        }
    }

    #[test]
    fn accepts_mailto() {
        assert!(check("mailto:info@davinci-cyber-engineering.uz").is_ok());
    }

    #[test]
    fn refuses_schemes_that_can_execute_or_read_files() {
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "ftp://example.com/x",
            "chrome://settings",
        ] {
            assert!(check(url).is_err(), "should be refused: {url}");
        }
    }

    #[test]
    fn refuses_the_loopback_host() {
        for url in [
            "http://localhost/",
            "http://LOCALHOST:8080/admin",
            "http://app.localhost/",
            "http://127.0.0.1/",
            "http://127.0.0.1:9200/_shutdown",
            "http://127.1.2.3/",
            "http://[::1]/",
        ] {
            assert!(check(url).is_err(), "should be refused: {url}");
        }
    }

    #[test]
    fn refuses_private_and_reserved_addresses() {
        for url in [
            "http://10.0.0.1/",
            "http://172.16.5.4/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/",
            "http://100.64.0.1/",
            "http://198.18.0.1/",
            "http://240.0.0.1/",
            "http://255.255.255.255/",
            "http://192.0.2.1/",
        ] {
            assert!(check(url).is_err(), "should be refused: {url}");
        }
    }

    #[test]
    fn refuses_ipv6_local_ranges() {
        for url in [
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://[fd12:3456::1]/",
            "http://[::]/",
        ] {
            assert!(check(url).is_err(), "should be refused: {url}");
        }
    }

    #[test]
    fn refuses_ipv4_mapped_loopback() {
        // The mapped form must not be a way around the IPv4 check.
        assert!(check("http://[::ffff:127.0.0.1]/").is_err());
        assert!(check("http://[::ffff:10.0.0.1]/").is_err());
        assert!(check("http://[::ffff:8.8.8.8]/").is_ok());
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(check("").is_err());
        assert!(check("   ").is_err());
        assert!(check("not a url").is_err());
    }

    #[test]
    fn a_trailing_dot_still_matches_localhost() {
        assert!(check("http://localhost./").is_err());
    }

    #[test]
    fn domain_classification_directly() {
        assert!(domain_is_public("example.com"));
        assert!(domain_is_public("example.com."));
        assert!(domain_is_public("sub.example.co.uk"));
        assert!(!domain_is_public("localhost"));
        assert!(!domain_is_public("localhost."));
        assert!(!domain_is_public("app.localhost"));
        assert!(!domain_is_public(""));
    }

    #[test]
    fn address_classification_directly() {
        assert!(is_public_v4(Ipv4Addr::new(8, 8, 4, 4)));
        assert!(is_public_v4(Ipv4Addr::new(93, 184, 216, 34)));
        assert!(!is_public_v4(Ipv4Addr::new(127, 0, 0, 1)));
        assert!(!is_public_v4(Ipv4Addr::new(192, 168, 0, 1)));

        assert!(is_public_v6("2606:4700::1111".parse().unwrap()));
        assert!(!is_public_v6("::1".parse().unwrap()));
        assert!(!is_public_v6("fe80::1".parse().unwrap()));
    }
}
