# AWS Public and Private API Segregation

This project demonstrates the provisioning of AWS infrastructure to create a secure private API using AWS API Gateway, VPC Endpoints, and exposing it through a public API using AWS Network Load Balancer (NLB).

In microservices architectures, teams often build and manage internal applications that they expose as private API endpoints and publicly expose those endpoints through a centralized API gateway where security protections are centrally managed. These API endpoints allow both internal and external users to leverage the functionality of those applications.

## Overview

The goal of this project is to:
- Create a secure private API inside a VPC.
- Expose the private API through a public API using a Network Load Balancer.
- Ensure secure communication and controlled access.

## Infrastructure Components

The following AWS services are used in this project:
- **VPC (Virtual Private Cloud)**: To create an isolated network.
- **Subnets**: To create network segments within the VPC.
- **Security Groups**: To control inbound and outbound traffic.
- **VPC Endpoints**: To privately connect your VPC to supported AWS services and VPC endpoint services.
- **API Gateway**: To create and manage REST APIs.
- **Network Load Balancer (NLB)**: To expose the private API as a public API.
- **Target Groups**: To route traffic to the VPC Endpoint.
- **Listeners**: To forward requests from the NLB to the target group.

## Prerequisites

- AWS account with appropriate permissions.
- Pulumi installed and configured.
- Node.js and npm installed.
- SST (Serverless Stack) installed.

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/alfie-far/aws-cloudfront-private-api.git
    cd aws-cloudfront-private-api
    ```

2. Install the dependencies:
    ```sh
    npm install
    ```

3. Configure your AWS credentials:
    ```sh
    export AWS_ACCESS_KEY_ID=your_access_key_id
    export AWS_SECRET_ACCESS_KEY=your_secret_access_key
    ```

4. Deploy the infrastructure:
    ```sh
    npx sst deploy --stage dev --print-logs
    ```

## Configuration

Update the `sst.config.ts` file to match your specific configuration needs, such as:
- AWS region
- VPC and Subnet CIDR blocks
- Security Group rules
- API Gateway settings
- Load Balancer settings

## Key Files

- **sst.config.ts**: Main configuration file for setting up the infrastructure using Pulumi and AWS SDK.

## Usage

After deploying the infrastructure, you will have two API Gateway endpoints:
- **Private API Endpoint**: Accessible only within the VPC.
- **Public API Endpoint**: Exposed through the Network Load Balancer and connected to the private endpoint via VPC Link.

You can test the entire setup end-to-end using the public test endpoint. The public API Gateway endpoint will allow you to access the private API securely.

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements.

## Contact

For any questions or support, please open an issue in the repository.
