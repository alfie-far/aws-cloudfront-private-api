/// <reference path="./.sst/platform/config.d.ts" />

import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export default $config({
  app(input) {
    return {
      name: 'sample-service-api',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    };
  },

  async run() {

    // VPC Parameters
    const vpcId = "vpc-0482063ca99527a0f"; //pulumi.output(input.vpcId);
    const vpcEndpointId = "vpce-01dbd644531d8985a"//pulumi.output(input.vpcEndpointId);
    const securityGroupIds = []; //pulumi.output(input.securityGroupIds);
    const subnetIds = []; //pulumi.output(input.subnetIds);

    // Private API Setup
    const privateApi = new sst.aws.ApiGatewayV1('private-api-sample', {
      endpoint: {
        type: "private",
        vpcEndpointIds: [vpcEndpointId]
      },
      transform: {
        api: (args) => {
          args.policy = JSON.stringify({
            "Version": "2012-10-17",
            "Statement": [
              {
                "Effect": "Allow",
                "Principal": "*",
                "Action": "execute-api:Invoke",
                "Resource": "arn:aws:execute-api:ap-southeast-2:*:*/*/*/*"
              }
            ]
          });
        },
      }
    });

    privateApi.route("GET /", {
        handler: "index.latest",
    });
    privateApi.deploy();


    const mainGateway = new aws.apigatewayv2.Api('billing-apis', {
      protocolType: 'HTTP',
      name: 'billing-apis',
    });

    // Create an HTTP Proxy integration to forward requests to a Load Balancer
    const integration = new aws.apigatewayv2.Integration('IntegrationOne', {
      apiId: mainGateway.id,
      integrationType: 'HTTP_PROXY',
      integrationUri: 'https://google.com/internal/a/b/c', // Public API, no VPC needed, Private APIs,
      // with a VPC Link ; Coarse/ fine Grained Routes
      integrationMethod: 'ANY',
      tlsConfig: {
        serverNameToVerify: 'google.com', // TLS verification
      }, // requestParameters: {
      //   "append:header.X-Forwarded-Host": "$context.domainName",
      //   "overwrite:path": "/Path-Is-Now-Overwritten",
      // },
    });

    // Create a route that proxies all requests to the integration
    new aws.apigatewayv2.Route('ProxyRoute', {
      apiId: mainGateway.id,
      routeKey: 'ANY /billing-commercial-api-path1/{proxy+}', // this is also related to Coarse/ fine Grained Routes
      authorizationType: 'NONE', // Control Allowed Authorisation Types
      target: pulumi.interpolate`integrations/${integration.id}`,
    });

    // Deploy the API
    /* const stage = */
    new aws.apigatewayv2.Stage('mainGatewayStage', {
      apiId: mainGateway.id,
      name: 'stage',
      autoDeploy: true,
    });

    const region = aws.getRegionOutput().name;
    const accountId = aws.getCallerIdentityOutput({}).accountId;

    // Step 2: Add CloudFront (CDN) to route all traffic to API Gateway
    const cdn = new aws.cloudfront.Distribution('BillingApiEdge', {
      comment: 'CloudFront in front of API Gateway',
      origins: [
        {
          originId: 'ApiGatewayOrigin',
          connectionAttempts: 3, // vpcOriginConfig: { ... },
          domainName: pulumi.interpolate`${mainGateway.id}.execute-api.${region}.amazonaws.com`, // originOverride: true, // ✅ Fix: Treat API Gateway as HTTP Origin
          customOriginConfig: {
            originSslProtocols: ['TLSv1.2'],
            originProtocolPolicy: 'https-only', // API Gateway requires HTTPS
            httpPort: 80,
            httpsPort: 443,
          },
          customHeaders: [
            {
              name: 'X-Forwarded-Host',
              value: 'billing-api.example.com',
            },
          ],
          originPath: '/stage',
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: 'ApiGatewayOrigin',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['HEAD', 'DELETE', 'POST', 'GET', 'OPTIONS', 'PUT', 'PATCH'], // ✅ Fixed valid method set
        cachedMethods: ['HEAD', 'GET', 'OPTIONS'], // ✅ Cache only safe methods
        originRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-AllViewerExceptHostHeader
        cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimized
        compress: true,
      },
      enabled: true,
      restrictions: {
        geoRestriction: {
          restrictionType: 'none', // No geographical restrictions
        },
      },
      viewerCertificate: {
        cloudfrontDefaultCertificate: true, // Uses default SSL from CloudFront
      }, // domain: {
      //   name: "billing-api.example.com", // Replace with your actual domain
      //   aliases: ["api.yourdomain.com"],
      //   dns: sst.aws.dns({
      //     zone: "Z2FDTNDATAQYW2", // Replace with your Route 53 Hosted Zone ID
      //   }),
      // },
    });

    // Output the CloudFront URL
    pulumi
      .all([cdn.domainName])
      .apply(([domain]) => console.log(`CloudFront Distribution URL: https://${domain}`));

    // new sst.aws.Cdn("Billing-API-Edge", {
    //   comment: ""
    // }, opts?);

    // const bucket = new sst.aws.Bucket("MyBucket");
    // const api = new sst.aws.ApiGatewayV2("MyApi");
    // // api.route("GET /", {
    // //
    // //   handler: "index.upload",
    // // });
    // api.route("GET /latest", {
    //
    //   handler: "index.latest",
    // });
  },
});
