resource "aws_ecs_cluster" "cosmo_router" {
  name = var.name
}

resource "aws_ecs_task_definition" "cosmo_router" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory

  task_role_arn      = aws_iam_role.cosmo_router_task_role.arn
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
      name      = var.name
      image     = var.image,
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
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "router"
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
          value = base64encode(file(var.config_file_path))
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
  name                 = var.name
  cluster              = aws_ecs_cluster.cosmo_router.name
  task_definition      = aws_ecs_task_definition.cosmo_router.arn
  force_new_deployment = true
  launch_type          = "FARGATE"
  desired_count        = var.min_instances

  load_balancer {
    target_group_arn = aws_lb_target_group.cosmo_router.arn
    container_name   = var.name
    container_port   = var.port
  }

  network_configuration {
    subnets = length(var.network_configuration_fargate_subnet_ids) > 0 ? var.network_configuration_fargate_subnet_ids : [
      aws_default_subnet.default_subnet_a[0].id,
      aws_default_subnet.default_subnet_b[0].id,
      aws_default_subnet.default_subnet_b[0].id
    ]
    # Assign public IP addresses to the container, otherwise they wouldn't be able to reach the internet.
    # Alternative would be to install a NAT Gateway in the VPC.
    assign_public_ip = true
    security_groups  = [aws_security_group.cosmo_router_service.id]
  }

  # Ignore the desired count after initial creation. This is required as when you scale up via
  # the AWS console and apply the Terraform configuration later on, it will try to scale down to the desired count.
  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_security_group" "cosmo_router_service" {

  vpc_id = var.network_configuration_vpc_id != "" ? var.network_configuration_vpc_id : aws_default_vpc.default_vpc[0].id

  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    # Only allow ingress traffic from the load balancer
    security_groups = [
      var.enable_tls ? aws_security_group.cosmo_router_load_balancer_https[0].id : aws_security_group.cosmo_router_load_balancer_http[0].id
    ]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}