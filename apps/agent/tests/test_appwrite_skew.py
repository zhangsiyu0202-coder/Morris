"""Pin down the SDK-vs-server packaging-gap detection.

The Appwrite Python SDK 20.x ships a pydantic model that targets the
unreleased Appwrite Server 1.9.5 response shape, while the latest
stable Docker image is 1.6.0 (the one we run locally). The gap shows
up in two recognisable shapes — a raw ``ValidationError`` or an
``AppwriteException`` whose message starts with
``"Unable to parse response into <Model>"`` — and the helper must
match both, while passing genuine HTTP/network errors through.

Once Appwrite ships 1.9.x as ``appwrite/appwrite:1.9`` on Docker Hub
and we upgrade, every call site using this helper can drop back to
the plain SDK call. Pin this test to detect that day.
"""
import pytest

from agent.persistence.appwrite_repository import _is_sdk_skew_error


def test_pydantic_validation_error_is_skew() -> None:
    pytest.importorskip("pydantic")
    from pydantic import BaseModel, ValidationError

    class _Doc(BaseModel):
        seq: int  # required

    try:
        _Doc.model_validate({})  # raises ValidationError
    except ValidationError as e:
        assert _is_sdk_skew_error(e)


def test_appwrite_exception_message_is_skew() -> None:
    err = RuntimeError("Unable to parse response into File: 3 validation errors for File")
    assert _is_sdk_skew_error(err)


def test_arbitrary_exception_is_not_skew() -> None:
    assert not _is_sdk_skew_error(RuntimeError("connection refused"))
    assert not _is_sdk_skew_error(ValueError("bad query: limit out of range"))


def test_404_message_is_not_skew() -> None:
    err = RuntimeError("Document with the requested ID could not be found.")
    assert not _is_sdk_skew_error(err)
