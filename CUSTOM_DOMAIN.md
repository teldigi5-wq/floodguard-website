# FloodGuard custom domain setup

The Amplify application is ready for a custom domain.

1. Open the FloodGuard app in AWS Amplify.
2. Choose Hosting and then Custom domains.
3. Choose Add domain and enter the domain you own.
4. Map the root domain to the production branch.
5. Redirect the www subdomain to the root domain.
6. If the domain is registered with Route 53, allow Amplify to configure DNS.
7. For another registrar, copy the displayed CNAME records into that registrar.
8. Wait until both domain activation and SSL certificate show Available.

Do not remove the existing amplifyapp.com address until the custom domain is fully active.
