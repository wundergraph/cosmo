// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.34.2
// 	protoc        (unknown)
// source: wg/cosmo/notifications/events.proto

package notifications

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type PlatformEventName int32

const (
	PlatformEventName_USER_REGISTER_SUCCESS  PlatformEventName = 0
	PlatformEventName_APOLLO_MIGRATE_INIT    PlatformEventName = 1
	PlatformEventName_APOLLO_MIGRATE_SUCCESS PlatformEventName = 2
	PlatformEventName_USER_DELETE_SUCCESS    PlatformEventName = 3
)

// Enum value maps for PlatformEventName.
var (
	PlatformEventName_name = map[int32]string{
		0: "USER_REGISTER_SUCCESS",
		1: "APOLLO_MIGRATE_INIT",
		2: "APOLLO_MIGRATE_SUCCESS",
		3: "USER_DELETE_SUCCESS",
	}
	PlatformEventName_value = map[string]int32{
		"USER_REGISTER_SUCCESS":  0,
		"APOLLO_MIGRATE_INIT":    1,
		"APOLLO_MIGRATE_SUCCESS": 2,
		"USER_DELETE_SUCCESS":    3,
	}
)

func (x PlatformEventName) Enum() *PlatformEventName {
	p := new(PlatformEventName)
	*p = x
	return p
}

func (x PlatformEventName) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (PlatformEventName) Descriptor() protoreflect.EnumDescriptor {
	return file_wg_cosmo_notifications_events_proto_enumTypes[0].Descriptor()
}

func (PlatformEventName) Type() protoreflect.EnumType {
	return &file_wg_cosmo_notifications_events_proto_enumTypes[0]
}

func (x PlatformEventName) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use PlatformEventName.Descriptor instead.
func (PlatformEventName) EnumDescriptor() ([]byte, []int) {
	return file_wg_cosmo_notifications_events_proto_rawDescGZIP(), []int{0}
}

type OrganizationEventName int32

const (
	OrganizationEventName_FEDERATED_GRAPH_SCHEMA_UPDATED OrganizationEventName = 0
	OrganizationEventName_MONOGRAPH_SCHEMA_UPDATED       OrganizationEventName = 1
	OrganizationEventName_VALIDATE_CONFIG                OrganizationEventName = 3
	OrganizationEventName_PROPOSAL_STATE_UPDATED         OrganizationEventName = 4
)

// Enum value maps for OrganizationEventName.
var (
	OrganizationEventName_name = map[int32]string{
		0: "FEDERATED_GRAPH_SCHEMA_UPDATED",
		1: "MONOGRAPH_SCHEMA_UPDATED",
		3: "VALIDATE_CONFIG",
		4: "PROPOSAL_STATE_UPDATED",
	}
	OrganizationEventName_value = map[string]int32{
		"FEDERATED_GRAPH_SCHEMA_UPDATED": 0,
		"MONOGRAPH_SCHEMA_UPDATED":       1,
		"VALIDATE_CONFIG":                3,
		"PROPOSAL_STATE_UPDATED":         4,
	}
)

func (x OrganizationEventName) Enum() *OrganizationEventName {
	p := new(OrganizationEventName)
	*p = x
	return p
}

func (x OrganizationEventName) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (OrganizationEventName) Descriptor() protoreflect.EnumDescriptor {
	return file_wg_cosmo_notifications_events_proto_enumTypes[1].Descriptor()
}

func (OrganizationEventName) Type() protoreflect.EnumType {
	return &file_wg_cosmo_notifications_events_proto_enumTypes[1]
}

func (x OrganizationEventName) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use OrganizationEventName.Descriptor instead.
func (OrganizationEventName) EnumDescriptor() ([]byte, []int) {
	return file_wg_cosmo_notifications_events_proto_rawDescGZIP(), []int{1}
}

type GraphSchemaUpdatedMeta struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	GraphIds []string `protobuf:"bytes,1,rep,name=graphIds,proto3" json:"graphIds,omitempty"`
}

func (x *GraphSchemaUpdatedMeta) Reset() {
	*x = GraphSchemaUpdatedMeta{}
	if protoimpl.UnsafeEnabled {
		mi := &file_wg_cosmo_notifications_events_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *GraphSchemaUpdatedMeta) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GraphSchemaUpdatedMeta) ProtoMessage() {}

func (x *GraphSchemaUpdatedMeta) ProtoReflect() protoreflect.Message {
	mi := &file_wg_cosmo_notifications_events_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GraphSchemaUpdatedMeta.ProtoReflect.Descriptor instead.
func (*GraphSchemaUpdatedMeta) Descriptor() ([]byte, []int) {
	return file_wg_cosmo_notifications_events_proto_rawDescGZIP(), []int{0}
}

func (x *GraphSchemaUpdatedMeta) GetGraphIds() []string {
	if x != nil {
		return x.GraphIds
	}
	return nil
}

type ProposalStateUpdatedMeta struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	GraphIds []string `protobuf:"bytes,1,rep,name=graphIds,proto3" json:"graphIds,omitempty"`
}

func (x *ProposalStateUpdatedMeta) Reset() {
	*x = ProposalStateUpdatedMeta{}
	if protoimpl.UnsafeEnabled {
		mi := &file_wg_cosmo_notifications_events_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *ProposalStateUpdatedMeta) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ProposalStateUpdatedMeta) ProtoMessage() {}

func (x *ProposalStateUpdatedMeta) ProtoReflect() protoreflect.Message {
	mi := &file_wg_cosmo_notifications_events_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ProposalStateUpdatedMeta.ProtoReflect.Descriptor instead.
func (*ProposalStateUpdatedMeta) Descriptor() ([]byte, []int) {
	return file_wg_cosmo_notifications_events_proto_rawDescGZIP(), []int{1}
}

func (x *ProposalStateUpdatedMeta) GetGraphIds() []string {
	if x != nil {
		return x.GraphIds
	}
	return nil
}

type EventMeta struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	EventName OrganizationEventName `protobuf:"varint,1,opt,name=event_name,json=eventName,proto3,enum=wg.cosmo.notifications.OrganizationEventName" json:"event_name,omitempty"`
	// Types that are assignable to Meta:
	//
	//	*EventMeta_FederatedGraphSchemaUpdated
	//	*EventMeta_MonographSchemaUpdated
	//	*EventMeta_ProposalStateUpdated
	Meta isEventMeta_Meta `protobuf_oneof:"meta"`
}

func (x *EventMeta) Reset() {
	*x = EventMeta{}
	if protoimpl.UnsafeEnabled {
		mi := &file_wg_cosmo_notifications_events_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *EventMeta) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*EventMeta) ProtoMessage() {}

func (x *EventMeta) ProtoReflect() protoreflect.Message {
	mi := &file_wg_cosmo_notifications_events_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use EventMeta.ProtoReflect.Descriptor instead.
func (*EventMeta) Descriptor() ([]byte, []int) {
	return file_wg_cosmo_notifications_events_proto_rawDescGZIP(), []int{2}
}

func (x *EventMeta) GetEventName() OrganizationEventName {
	if x != nil {
		return x.EventName
	}
	return OrganizationEventName_FEDERATED_GRAPH_SCHEMA_UPDATED
}

func (m *EventMeta) GetMeta() isEventMeta_Meta {
	if m != nil {
		return m.Meta
	}
	return nil
}

func (x *EventMeta) GetFederatedGraphSchemaUpdated() *GraphSchemaUpdatedMeta {
	if x, ok := x.GetMeta().(*EventMeta_FederatedGraphSchemaUpdated); ok {
		return x.FederatedGraphSchemaUpdated
	}
	return nil
}

func (x *EventMeta) GetMonographSchemaUpdated() *GraphSchemaUpdatedMeta {
	if x, ok := x.GetMeta().(*EventMeta_MonographSchemaUpdated); ok {
		return x.MonographSchemaUpdated
	}
	return nil
}

func (x *EventMeta) GetProposalStateUpdated() *ProposalStateUpdatedMeta {
	if x, ok := x.GetMeta().(*EventMeta_ProposalStateUpdated); ok {
		return x.ProposalStateUpdated
	}
	return nil
}

type isEventMeta_Meta interface {
	isEventMeta_Meta()
}

type EventMeta_FederatedGraphSchemaUpdated struct {
	FederatedGraphSchemaUpdated *GraphSchemaUpdatedMeta `protobuf:"bytes,2,opt,name=federated_graph_schema_updated,json=federatedGraphSchemaUpdated,proto3,oneof"`
}

type EventMeta_MonographSchemaUpdated struct {
	MonographSchemaUpdated *GraphSchemaUpdatedMeta `protobuf:"bytes,3,opt,name=monograph_schema_updated,json=monographSchemaUpdated,proto3,oneof"`
}

type EventMeta_ProposalStateUpdated struct {
	ProposalStateUpdated *ProposalStateUpdatedMeta `protobuf:"bytes,4,opt,name=proposal_state_updated,json=proposalStateUpdated,proto3,oneof"`
}

func (*EventMeta_FederatedGraphSchemaUpdated) isEventMeta_Meta() {}

func (*EventMeta_MonographSchemaUpdated) isEventMeta_Meta() {}

func (*EventMeta_ProposalStateUpdated) isEventMeta_Meta() {}

var File_wg_cosmo_notifications_events_proto protoreflect.FileDescriptor

var file_wg_cosmo_notifications_events_proto_rawDesc = []byte{
	0x0a, 0x23, 0x77, 0x67, 0x2f, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2f, 0x6e, 0x6f, 0x74, 0x69, 0x66,
	0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2f, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x73, 0x2e,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12, 0x16, 0x77, 0x67, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e,
	0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x22, 0x34, 0x0a,
	0x16, 0x47, 0x72, 0x61, 0x70, 0x68, 0x53, 0x63, 0x68, 0x65, 0x6d, 0x61, 0x55, 0x70, 0x64, 0x61,
	0x74, 0x65, 0x64, 0x4d, 0x65, 0x74, 0x61, 0x12, 0x1a, 0x0a, 0x08, 0x67, 0x72, 0x61, 0x70, 0x68,
	0x49, 0x64, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x09, 0x52, 0x08, 0x67, 0x72, 0x61, 0x70, 0x68,
	0x49, 0x64, 0x73, 0x22, 0x36, 0x0a, 0x18, 0x50, 0x72, 0x6f, 0x70, 0x6f, 0x73, 0x61, 0x6c, 0x53,
	0x74, 0x61, 0x74, 0x65, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x74, 0x61, 0x12,
	0x1a, 0x0a, 0x08, 0x67, 0x72, 0x61, 0x70, 0x68, 0x49, 0x64, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28,
	0x09, 0x52, 0x08, 0x67, 0x72, 0x61, 0x70, 0x68, 0x49, 0x64, 0x73, 0x22, 0xae, 0x03, 0x0a, 0x09,
	0x45, 0x76, 0x65, 0x6e, 0x74, 0x4d, 0x65, 0x74, 0x61, 0x12, 0x4c, 0x0a, 0x0a, 0x65, 0x76, 0x65,
	0x6e, 0x74, 0x5f, 0x6e, 0x61, 0x6d, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x2d, 0x2e,
	0x77, 0x67, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e, 0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63,
	0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x4f, 0x72, 0x67, 0x61, 0x6e, 0x69, 0x7a, 0x61, 0x74,
	0x69, 0x6f, 0x6e, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x4e, 0x61, 0x6d, 0x65, 0x52, 0x09, 0x65, 0x76,
	0x65, 0x6e, 0x74, 0x4e, 0x61, 0x6d, 0x65, 0x12, 0x75, 0x0a, 0x1e, 0x66, 0x65, 0x64, 0x65, 0x72,
	0x61, 0x74, 0x65, 0x64, 0x5f, 0x67, 0x72, 0x61, 0x70, 0x68, 0x5f, 0x73, 0x63, 0x68, 0x65, 0x6d,
	0x61, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x2e, 0x2e, 0x77, 0x67, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e, 0x6e, 0x6f, 0x74, 0x69, 0x66,
	0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x47, 0x72, 0x61, 0x70, 0x68, 0x53, 0x63,
	0x68, 0x65, 0x6d, 0x61, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x74, 0x61, 0x48,
	0x00, 0x52, 0x1b, 0x66, 0x65, 0x64, 0x65, 0x72, 0x61, 0x74, 0x65, 0x64, 0x47, 0x72, 0x61, 0x70,
	0x68, 0x53, 0x63, 0x68, 0x65, 0x6d, 0x61, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x12, 0x6a,
	0x0a, 0x18, 0x6d, 0x6f, 0x6e, 0x6f, 0x67, 0x72, 0x61, 0x70, 0x68, 0x5f, 0x73, 0x63, 0x68, 0x65,
	0x6d, 0x61, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0b,
	0x32, 0x2e, 0x2e, 0x77, 0x67, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e, 0x6e, 0x6f, 0x74, 0x69,
	0x66, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x47, 0x72, 0x61, 0x70, 0x68, 0x53,
	0x63, 0x68, 0x65, 0x6d, 0x61, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x74, 0x61,
	0x48, 0x00, 0x52, 0x16, 0x6d, 0x6f, 0x6e, 0x6f, 0x67, 0x72, 0x61, 0x70, 0x68, 0x53, 0x63, 0x68,
	0x65, 0x6d, 0x61, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x12, 0x68, 0x0a, 0x16, 0x70, 0x72,
	0x6f, 0x70, 0x6f, 0x73, 0x61, 0x6c, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x5f, 0x75, 0x70, 0x64,
	0x61, 0x74, 0x65, 0x64, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x30, 0x2e, 0x77, 0x67, 0x2e,
	0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e, 0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0x74, 0x69,
	0x6f, 0x6e, 0x73, 0x2e, 0x50, 0x72, 0x6f, 0x70, 0x6f, 0x73, 0x61, 0x6c, 0x53, 0x74, 0x61, 0x74,
	0x65, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x74, 0x61, 0x48, 0x00, 0x52, 0x14,
	0x70, 0x72, 0x6f, 0x70, 0x6f, 0x73, 0x61, 0x6c, 0x53, 0x74, 0x61, 0x74, 0x65, 0x55, 0x70, 0x64,
	0x61, 0x74, 0x65, 0x64, 0x42, 0x06, 0x0a, 0x04, 0x6d, 0x65, 0x74, 0x61, 0x2a, 0x7c, 0x0a, 0x11,
	0x50, 0x6c, 0x61, 0x74, 0x66, 0x6f, 0x72, 0x6d, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x4e, 0x61, 0x6d,
	0x65, 0x12, 0x19, 0x0a, 0x15, 0x55, 0x53, 0x45, 0x52, 0x5f, 0x52, 0x45, 0x47, 0x49, 0x53, 0x54,
	0x45, 0x52, 0x5f, 0x53, 0x55, 0x43, 0x43, 0x45, 0x53, 0x53, 0x10, 0x00, 0x12, 0x17, 0x0a, 0x13,
	0x41, 0x50, 0x4f, 0x4c, 0x4c, 0x4f, 0x5f, 0x4d, 0x49, 0x47, 0x52, 0x41, 0x54, 0x45, 0x5f, 0x49,
	0x4e, 0x49, 0x54, 0x10, 0x01, 0x12, 0x1a, 0x0a, 0x16, 0x41, 0x50, 0x4f, 0x4c, 0x4c, 0x4f, 0x5f,
	0x4d, 0x49, 0x47, 0x52, 0x41, 0x54, 0x45, 0x5f, 0x53, 0x55, 0x43, 0x43, 0x45, 0x53, 0x53, 0x10,
	0x02, 0x12, 0x17, 0x0a, 0x13, 0x55, 0x53, 0x45, 0x52, 0x5f, 0x44, 0x45, 0x4c, 0x45, 0x54, 0x45,
	0x5f, 0x53, 0x55, 0x43, 0x43, 0x45, 0x53, 0x53, 0x10, 0x03, 0x2a, 0x8a, 0x01, 0x0a, 0x15, 0x4f,
	0x72, 0x67, 0x61, 0x6e, 0x69, 0x7a, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x45, 0x76, 0x65, 0x6e, 0x74,
	0x4e, 0x61, 0x6d, 0x65, 0x12, 0x22, 0x0a, 0x1e, 0x46, 0x45, 0x44, 0x45, 0x52, 0x41, 0x54, 0x45,
	0x44, 0x5f, 0x47, 0x52, 0x41, 0x50, 0x48, 0x5f, 0x53, 0x43, 0x48, 0x45, 0x4d, 0x41, 0x5f, 0x55,
	0x50, 0x44, 0x41, 0x54, 0x45, 0x44, 0x10, 0x00, 0x12, 0x1c, 0x0a, 0x18, 0x4d, 0x4f, 0x4e, 0x4f,
	0x47, 0x52, 0x41, 0x50, 0x48, 0x5f, 0x53, 0x43, 0x48, 0x45, 0x4d, 0x41, 0x5f, 0x55, 0x50, 0x44,
	0x41, 0x54, 0x45, 0x44, 0x10, 0x01, 0x12, 0x13, 0x0a, 0x0f, 0x56, 0x41, 0x4c, 0x49, 0x44, 0x41,
	0x54, 0x45, 0x5f, 0x43, 0x4f, 0x4e, 0x46, 0x49, 0x47, 0x10, 0x03, 0x12, 0x1a, 0x0a, 0x16, 0x50,
	0x52, 0x4f, 0x50, 0x4f, 0x53, 0x41, 0x4c, 0x5f, 0x53, 0x54, 0x41, 0x54, 0x45, 0x5f, 0x55, 0x50,
	0x44, 0x41, 0x54, 0x45, 0x44, 0x10, 0x04, 0x42, 0xed, 0x01, 0x0a, 0x1a, 0x63, 0x6f, 0x6d, 0x2e,
	0x77, 0x67, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x2e, 0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63,
	0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x42, 0x0b, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x73, 0x50, 0x72,
	0x6f, 0x74, 0x6f, 0x50, 0x01, 0x5a, 0x48, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f,
	0x6d, 0x2f, 0x77, 0x75, 0x6e, 0x64, 0x65, 0x72, 0x67, 0x72, 0x61, 0x70, 0x68, 0x2f, 0x63, 0x6f,
	0x73, 0x6d, 0x6f, 0x2f, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x2d, 0x67, 0x6f, 0x2f, 0x67,
	0x65, 0x6e, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x77, 0x67, 0x2f, 0x63, 0x6f, 0x73, 0x6d,
	0x6f, 0x2f, 0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0xa2,
	0x02, 0x03, 0x57, 0x43, 0x4e, 0xaa, 0x02, 0x16, 0x57, 0x67, 0x2e, 0x43, 0x6f, 0x73, 0x6d, 0x6f,
	0x2e, 0x4e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0xca, 0x02,
	0x16, 0x57, 0x67, 0x5c, 0x43, 0x6f, 0x73, 0x6d, 0x6f, 0x5c, 0x4e, 0x6f, 0x74, 0x69, 0x66, 0x69,
	0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0xe2, 0x02, 0x22, 0x57, 0x67, 0x5c, 0x43, 0x6f, 0x73,
	0x6d, 0x6f, 0x5c, 0x4e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73,
	0x5c, 0x47, 0x50, 0x42, 0x4d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61, 0xea, 0x02, 0x18, 0x57,
	0x67, 0x3a, 0x3a, 0x43, 0x6f, 0x73, 0x6d, 0x6f, 0x3a, 0x3a, 0x4e, 0x6f, 0x74, 0x69, 0x66, 0x69,
	0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_wg_cosmo_notifications_events_proto_rawDescOnce sync.Once
	file_wg_cosmo_notifications_events_proto_rawDescData = file_wg_cosmo_notifications_events_proto_rawDesc
)

func file_wg_cosmo_notifications_events_proto_rawDescGZIP() []byte {
	file_wg_cosmo_notifications_events_proto_rawDescOnce.Do(func() {
		file_wg_cosmo_notifications_events_proto_rawDescData = protoimpl.X.CompressGZIP(file_wg_cosmo_notifications_events_proto_rawDescData)
	})
	return file_wg_cosmo_notifications_events_proto_rawDescData
}

var file_wg_cosmo_notifications_events_proto_enumTypes = make([]protoimpl.EnumInfo, 2)
var file_wg_cosmo_notifications_events_proto_msgTypes = make([]protoimpl.MessageInfo, 3)
var file_wg_cosmo_notifications_events_proto_goTypes = []any{
	(PlatformEventName)(0),           // 0: wg.cosmo.notifications.PlatformEventName
	(OrganizationEventName)(0),       // 1: wg.cosmo.notifications.OrganizationEventName
	(*GraphSchemaUpdatedMeta)(nil),   // 2: wg.cosmo.notifications.GraphSchemaUpdatedMeta
	(*ProposalStateUpdatedMeta)(nil), // 3: wg.cosmo.notifications.ProposalStateUpdatedMeta
	(*EventMeta)(nil),                // 4: wg.cosmo.notifications.EventMeta
}
var file_wg_cosmo_notifications_events_proto_depIdxs = []int32{
	1, // 0: wg.cosmo.notifications.EventMeta.event_name:type_name -> wg.cosmo.notifications.OrganizationEventName
	2, // 1: wg.cosmo.notifications.EventMeta.federated_graph_schema_updated:type_name -> wg.cosmo.notifications.GraphSchemaUpdatedMeta
	2, // 2: wg.cosmo.notifications.EventMeta.monograph_schema_updated:type_name -> wg.cosmo.notifications.GraphSchemaUpdatedMeta
	3, // 3: wg.cosmo.notifications.EventMeta.proposal_state_updated:type_name -> wg.cosmo.notifications.ProposalStateUpdatedMeta
	4, // [4:4] is the sub-list for method output_type
	4, // [4:4] is the sub-list for method input_type
	4, // [4:4] is the sub-list for extension type_name
	4, // [4:4] is the sub-list for extension extendee
	0, // [0:4] is the sub-list for field type_name
}

func init() { file_wg_cosmo_notifications_events_proto_init() }
func file_wg_cosmo_notifications_events_proto_init() {
	if File_wg_cosmo_notifications_events_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_wg_cosmo_notifications_events_proto_msgTypes[0].Exporter = func(v any, i int) any {
			switch v := v.(*GraphSchemaUpdatedMeta); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_wg_cosmo_notifications_events_proto_msgTypes[1].Exporter = func(v any, i int) any {
			switch v := v.(*ProposalStateUpdatedMeta); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_wg_cosmo_notifications_events_proto_msgTypes[2].Exporter = func(v any, i int) any {
			switch v := v.(*EventMeta); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
	}
	file_wg_cosmo_notifications_events_proto_msgTypes[2].OneofWrappers = []any{
		(*EventMeta_FederatedGraphSchemaUpdated)(nil),
		(*EventMeta_MonographSchemaUpdated)(nil),
		(*EventMeta_ProposalStateUpdated)(nil),
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_wg_cosmo_notifications_events_proto_rawDesc,
			NumEnums:      2,
			NumMessages:   3,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_wg_cosmo_notifications_events_proto_goTypes,
		DependencyIndexes: file_wg_cosmo_notifications_events_proto_depIdxs,
		EnumInfos:         file_wg_cosmo_notifications_events_proto_enumTypes,
		MessageInfos:      file_wg_cosmo_notifications_events_proto_msgTypes,
	}.Build()
	File_wg_cosmo_notifications_events_proto = out.File
	file_wg_cosmo_notifications_events_proto_rawDesc = nil
	file_wg_cosmo_notifications_events_proto_goTypes = nil
	file_wg_cosmo_notifications_events_proto_depIdxs = nil
}
