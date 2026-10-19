from rest_framework import serializers


class GoogleStatusSerializer(serializers.Serializer):
    configured = serializers.BooleanField(help_text="Client ID/secret set on the server.")
    connected = serializers.BooleanField()
    needs_reconnect = serializers.BooleanField()
    email = serializers.EmailField(allow_blank=True, allow_null=True)
    scopes = serializers.ListField(child=serializers.CharField())
    expires_at = serializers.DateTimeField(allow_null=True)
    connected_at = serializers.DateTimeField(allow_null=True)
