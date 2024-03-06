
data "aws_region" "current" {}

resource "aws_iam_role" "cosmo_router_task_execution_role" {
  name               = "${var.name}-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        },
        Effect = "Allow"
        Sid = ""
      }
    ]
  })
}

resource "aws_iam_role_policy" "cosmo_router" {
  name = "${var.name}-secret-access-policy"
  role = aws_iam_role.cosmo_router_task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt",
        ]
        Effect   = "Allow"
        Resource = var.secret_arn
    },
    {
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Effect   = "Allow"
      Resource = "arn:aws:logs:*:*:*"
    }
    ]
  })
}

resource "aws_iam_role" "cosmo_router_task_role" {
  name               = "${var.name}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        },
        Effect = "Allow",
        Sid = ""
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "cosmo_router" {
  name              = "/ecs/${var.name}"
  retention_in_days = 90
}

resource "aws_ecs_task_definition" "cosmo_router" {
  family                   = "${var.name}-task-def"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory

  task_role_arn = aws_iam_role.cosmo_router_task_role.arn
  execution_role_arn = aws_iam_role.cosmo_router_task_execution_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "cosmo-config-volume"
  }

  container_definitions = jsonencode([
      {
        name      = "${var.name}-container",
        image     = "ghcr.io/wundergraph/cosmo/router:${var.release}",
        essential = true



        portMappings = [
          {
            name          = "http"
            containerPort = var.port
            hostPort      = var.port
            protocol      = "tcp"
          },
        ]

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = "/ecs/${var.name}"
            awslogs-region        = 
data.aws_region.current.name            awslogs-stream-prefix = "router"
          }
        }

        dependsOn = [
          {
            condition     = "COMPLETE"
            containerName = "cosmo-config"
          }
        ]

        mountPoints = [
          {
            containerPath = "/etc/cosmo"
            sourceVolume  = "cosmo-config-volume"
          }
        ]

        # The Cosmo Router will pick up these environment variables.
        # They are mentioned in the `config.yaml` that gets mounted into this
        # container. Subsequently, Cosmo replaces the placeholders in the config file 
        # with the values from the environment.
        environment = [
          {
            name  = "PORT"
            value = tostring(var.port)
          },
          {
            name  = "CONFIG_PATH"
            value = "/etc/cosmo/config.yaml"
          },
        ]

        secrets = [
          {
            name      = "GRAPH_API_TOKEN"
            valueFrom = "${var.secret_arn}:GRAPH_API_TOKEN::"
          }
        ]
      },      
      # Cosmo Configuration Init Container
      {
        name  = "cosmo-config"
        image = "bash:5"

        essential = false

        command = [
          "-c",
          "echo $COSMO_CONFIG | base64 -d - | tee /etc/cosmo/config.yaml"
        ]

        environment = [
          {
            name  = "COSMO_CONFIG"
            value = base64encode(file("${path.module}/config.yaml"))
          },
        ]

        mountPoints = [
          {
            containerPath = "/etc/cosmo"
            sourceVolume  = "cosmo-config-volume"
          }
        ]
      }
    ])
}

resource "aws_ecs_service" "cosmo_router" {
  name                   = var.name
  cluster                = var.cluster
  task_definition        = aws_ecs_task_definition.cosmo_router.arn
  force_new_deployment   = true
  launch_type            = "FARGATE"
  enable_execute_command = true
  desired_count = 1

  network_configuration {
    subnets = var.subnets
    # Set `assign_public_ip` to false in a production setup. This is only required here
    # to allow the container to reach the secret manager API. In a production setup, it is
    # recommended to have private and public subnets with traffic routed through a NAT Gateway / Internet Gateway.
    assign_public_ip = true
  }

  # Ignore the desired count after initial creation.
  # This configuration option is useful when you have autoscaling enabled for your Cosmo Router.
  # By ignoring the desired count, applying changes to the service will not trigger a potential downscaling.
  # This can be beneficial to prevent unnecessary disruptions to Cosmo Router's availability.
  lifecycle {
    ignore_changes = [desired_count]
  }
}
