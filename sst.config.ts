/// <reference path="./.sst/platform/config.d.ts" />

import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

// Constants
const CERTIFICATE_ARN =
  'arn:aws:acm:ap-southeast-2:610034861450:certificate/69d106cf-0341-43bd-9a26-421dc57cdc04';

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
    const regionOutput = aws.getRegionOutput();
    const callerIdentityOutput = aws.getCallerIdentityOutput();

    const region = regionOutput.name;
    const accountId = callerIdentityOutput.accountId;

    // Create a VPC
    const vpc = new aws.ec2.Vpc('MyVPC', {
      cidrBlock: '10.0.0.0/16',
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: { Name: 'product-internal-network' },
    });

    // Create a subnet inside the VPC
    const subnet = new aws.ec2.Subnet('DefaultSubnet', {
      vpcId: vpc.id,
      cidrBlock: '10.0.1.0/24',
      mapPublicIpOnLaunch: true,
      availabilityZone: pulumi.interpolate`${region}a`, // Change as needed
      tags: { Name: 'DefaultSubnet' },
    });

    // Create a Security Group for the VPC Endpoint
    const securityGroup = new aws.ec2.SecurityGroup('VpcEndpointSG', {
      vpcId: vpc.id,
      description: 'Allow API Gateway access',
      ingress: [
        {
          protocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          cidrBlocks: ['0.0.0.0/0'], // Restrict to specific IPs if needed
        },
      ],
      egress: [
        {
          protocol: '-1',
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ['0.0.0.0/0'],
        },
      ],
      tags: { Name: 'VpcEndpointSG' },
    });

    // Create a VPC Endpoint for API Gateway
    const vpcEndpoint = new aws.ec2.VpcEndpoint('ApiGatewayVpcEndpoint', {
      vpcId: vpc.id,
      serviceName: pulumi.interpolate`com.amazonaws.${region}.execute-api`, // API Gateway VPC Endpoint Service
      vpcEndpointType: 'Interface', // Supports Private API Gateway
      subnetIds: [subnet.id],
      securityGroupIds: [securityGroup.id],
      privateDnsEnabled: true, // Enables private DNS for API Gateway
      tags: { Name: 'ApiGatewayVpcEndpoint' },
    });

    const networkInterfaceDetails = aws.ec2.getNetworkInterfaceOutput({
      id: vpcEndpoint.networkInterfaceIds[0],
    });

    // Extract the Private IP Address
    const vpcEndpointPrivateIp = networkInterfaceDetails.privateIp.apply(
      (ip) => ip || 'No IP Found',
    );

    // Debugging Out

    pulumi
      .all([
        vpc.id,
        subnet.id,
        vpcEndpoint.id,
        vpcEndpointPrivateIp,
        vpcEndpoint.cidrBlocks,
        vpcEndpoint.networkInterfaceIds,
        networkInterfaceDetails.privateIp,
        networkInterfaceDetails.privateIps,
      ])
      .apply(
        ([vpcId, subnetId, endpointId, vpcEndpointPrivateIp, cidr, eni, privateIp, privateIps]) => {
          console.log(`VPC ID: ${vpcId}`);
          console.log(`Subnet ID: ${subnetId}`);
          console.log(`VPC Endpoint ID: ${endpointId}`);
          console.log(`VPC Endpoint cidr:`, cidr);
          console.log(`VPC Endpoint eni:`, eni);

          console.log(vpcEndpointPrivateIp);
          console.log(`networkInterfaceDetails privateIp:`, privateIp);
          console.log(`networkInterfaceDetails privateIps:`, privateIps);
        },
      );

    const gatewayDomainName = new aws.apigateway.DomainName('private-gateway-dns', {
      certificateArn: CERTIFICATE_ARN,
      endpointConfiguration: {
        types: ['PRIVATE'],
      },
      domainName: 'api.steady.zone', // Set your private domain
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 'execute-api:Invoke',
            Resource: '*',
          },
        ],
      }),
    });

    // Private API Setup
    const privateApi = new sst.aws.ApiGatewayV1('private-api-sample', {
      endpoint: {
        type: 'private',
        vpcEndpointIds: [vpcEndpoint.id],
      },
      transform: {
        api: (args) => {
          args.policy = JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: 'execute-api:Invoke',
                Resource: '*',
              },
            ],
          });
        },
      },
    });

    privateApi.route('GET /', {
      handler: 'index.latest',
    });
    privateApi.deploy();

    const basePathMapping = new aws.apigateway.BasePathMapping('gateway-path-mapping', {
      restApi: privateApi.api.id,
      basePath: privateApi.stage.stageName,
      stageName: privateApi.stage.stageName,
      domainNameId: gatewayDomainName.domainNameId,
      domainName: gatewayDomainName.domainName,
    });

    const example = new aws.apigateway.DomainNameAccessAssociation(
      'gateway-path-mapping-association',
      {
        accessAssociationSource: vpcEndpoint.id,
        accessAssociationSourceType: 'VPCE',
        domainNameArn: gatewayDomainName.arn,
      },
    );

    const lbSecurityGroup = new aws.ec2.SecurityGroup('LbSecurityGroup', {
      vpcId: vpc.id,
      description: 'Allow API Gateway traffic',
      ingress: [
        {
          protocol: 'tcp',
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ['0.0.0.0/0'], // Adjust based on your security needs
        },
        {
          protocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          cidrBlocks: ['0.0.0.0/0'], // Adjust based on your security needs
        },
      ],
      egress: [
        {
          protocol: '-1',
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ['0.0.0.0/0'],
        },
      ],
      tags: { Name: 'LbSecurityGroup' },
    });

    // Create a Network Load Balancer (NLB) inside the Private Subnet
    const nlb = new aws.lb.LoadBalancer('APILinkNLB', {
      internal: true, // Internal LB for VPC Link
      loadBalancerType: 'network',
      subnets: [subnet.id],
      securityGroups: [lbSecurityGroup.id],
      tags: { Name: 'APILinkNLB' },
    });

    const exampleVpcLink = new aws.apigateway.VpcLink('VPCLinkForRestAPIs', {
      name: 'VPCLinkForRestAPIs',
      description: 'VPCLinkForRestAPIs',
      targetArn: nlb.arn,
    });

    const vpcLink = new aws.apigatewayv2.VpcLink('VPCLinkForHTTPSAPIs', {
      name: 'VPCLinkForHTTPSAPIs',
      securityGroupIds: [lbSecurityGroup.id], // Attach security group
      subnetIds: [subnet.id], // Attach to the correct subnet
      tags: { Name: 'VPCLinkForHTTPSAPIs' },
    });

    // Step 5: Create a Target Group for the Load Balancer
    const httpsTargetGroup = new aws.lb.TargetGroup('HTTPSTargetGroup', {
      port: 443, // API Gateway typically runs on HTTPS
      protocol: 'TLS',
      vpcId: vpc.id,
      targetType: 'ip', // Targeting Private API Gateway via VPC Endpoint IP
      healthCheck: {
        protocol: 'TCP', // TCP layer health check
        interval: 30, // 30-second health check interval
        timeout: 10, // Timeout for health check
        healthyThreshold: 2, // Mark as healthy after 2 successful checks
        unhealthyThreshold: 2, // Mark as unhealthy after 2 failed checks
      },
      tags: { Name: 'HTTPSTargetGroup' },
    });

    const targetAttachment = new aws.lb.TargetGroupAttachment('VpcEndpointTarget', {
      targetGroupArn: httpsTargetGroup.arn,
      port: 443, // same as target group
      targetId: vpcEndpointPrivateIp, // || "10.0.1.218", // Private IP of the VPC Endpoint
    });

    pulumi.all([httpsTargetGroup.arn, httpsTargetGroup.name]).apply(([tgArn, tgName]) => {
      console.log(`Target Group Created: ${tgName} (${tgArn})`);
    });

    // Step 6: Create a Listener for the Load Balancer
    // Define NLB Listener
    const nlbListener = new aws.lb.Listener('APILinkNLBListener1', {
      loadBalancerArn: nlb.arn,
      port: 443, // Change this if your NLB uses a different port
      protocol: 'TLS',
      sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      alpnPolicy: 'HTTP2Optional',
      certificateArn: CERTIFICATE_ARN, // Replace with actual ACM certificate ARN
      defaultActions: [
        {
          type: 'forward',
          targetGroupArn: httpsTargetGroup.arn, // Replace with different Target Group ARN depending on your use-case
        },
      ],
    });

    // const mainGateway = new aws.apigatewayv2.Api('billing-apis', {
    //   protocolType: 'HTTP',
    //   name: 'billing-apis',
    // });

    // // Create an HTTP Proxy integration to forward requests to a Load Balancer
    // const integration = new aws.apigatewayv2.Integration('IntegrationOne', {
    //   apiId: mainGateway.id,
    //   integrationType: 'HTTP_PROXY',
    //   integrationUri: 'https://google.com/internal/a/b/c', // Public API, no VPC needed, Private APIs,
    //   // with a VPC Link ; Coarse/ fine Grained Routes
    //   integrationMethod: 'ANY',
    //   tlsConfig: {
    //     serverNameToVerify: 'google.com', // TLS verification
    //   }, // requestParameters: {
    //   //   "append:header.X-Forwarded-Host": "$context.domainName",
    //   //   "overwrite:path": "/Path-Is-Now-Overwritten",
    //   // },
    // });

    // // Create a route that proxies all requests to the integration
    // new aws.apigatewayv2.Route('ProxyRoute', {
    //   apiId: mainGateway.id,
    //   routeKey: 'ANY /billing-commercial-api-path1/{proxy+}', // this is also related to Coarse/ fine Grained Routes
    //   authorizationType: 'NONE', // Control Allowed Authorisation Types
    //   target: pulumi.interpolate`integrations/${integration.id}`,
    // });

    // // Deploy the API
    // /* const stage = */
    // new aws.apigatewayv2.Stage('mainGatewayStage', {
    //   apiId: mainGateway.id,
    //   name: 'stage',
    //   autoDeploy: true,
    // });

    // Step 2: Add CloudFront (CDN) to route all traffic to API Gateway
    // const cdn = new aws.cloudfront.Distribution('BillingApiEdge', {
    //   comment: 'CloudFront in front of API Gateway',
    //   origins: [
    //     {
    //       originId: 'ApiGatewayOrigin',
    //       connectionAttempts: 3, // vpcOriginConfig: { ... },
    //       domainName: pulumi.interpolate`${mainGateway.id}.execute-api.${region}.amazonaws.com`, // originOverride: true, // ✅ Fix: Treat API Gateway as HTTP Origin
    //       customOriginConfig: {
    //         originSslProtocols: ['TLSv1.2'],
    //         originProtocolPolicy: 'https-only', // API Gateway requires HTTPS
    //         httpPort: 80,
    //         httpsPort: 443,
    //       },
    //       customHeaders: [
    //         {
    //           name: 'X-Forwarded-Host',
    //           value: 'billing-api.example.com',
    //         },
    //       ],
    //       originPath: '/stage',
    //     },
    //   ],
    //   defaultCacheBehavior: {
    //     targetOriginId: 'ApiGatewayOrigin',
    //     viewerProtocolPolicy: 'redirect-to-https',
    //     allowedMethods: ['HEAD', 'DELETE', 'POST', 'GET', 'OPTIONS', 'PUT', 'PATCH'], // ✅ Fixed valid method set
    //     cachedMethods: ['HEAD', 'GET', 'OPTIONS'], // ✅ Cache only safe methods
    //     originRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-AllViewerExceptHostHeader
    //     cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimized
    //     compress: true,
    //   },
    //   enabled: true,
    //   restrictions: {
    //     geoRestriction: {
    //       restrictionType: 'none', // No geographical restrictions
    //     },
    //   },
    //   viewerCertificate: {
    //     cloudfrontDefaultCertificate: true, // Uses default SSL from CloudFront
    //   }, // domain: {
    //   //   name: "billing-api.example.com", // Replace with your actual domain
    //   //   aliases: ["api.yourdomain.com"],
    //   //   dns: sst.aws.dns({
    //   //     zone: "Z2FDTNDATAQYW2", // Replace with your Route 53 Hosted Zone ID
    //   //   }),
    //   // },
    // });

    // // Output the CloudFront URL
    // pulumi
    //   .all([cdn.domainName])
    //   .apply(([domain]) => console.log(`CloudFront Distribution URL: https://${domain}`));

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
